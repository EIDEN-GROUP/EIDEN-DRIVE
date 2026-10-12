export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { accountAccessToken, clientFor, getAccounts, pickUploadAccount, requireActiveAccount } from "@/lib/drive-accounts";
import { rootFor } from "@/lib/google-drive";
import { googleErrorMessage } from "@/lib/errors";
import { folderUsable, googleInScope } from "@/lib/visibility";
import { rateLimited } from "@/lib/rate";
import { DRIVE_ID_RE, RESUMABLE_MAX, initiateResumableSession } from "@/lib/resumable";
import { parseJson } from "@/lib/http";

// Step 1 of direct-to-Google resumable upload (Supabase is never involved):
// authorize + open a Drive session bound to exact metadata, hand the browser
// a session URI to PUT chunks to directly. Nothing is indexed here — the file
// doesn't exist yet. Step 2 (complete) verifies and registers it.
const Body = z.object({
  name: z.string().trim().min(1).max(255),
  mime: z.string().max(127).default("application/octet-stream"),
  size: z.number().int().positive().max(RESUMABLE_MAX),
  hash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  folder: z.string().uuid().nullable().optional(),
  drive_account: z.string().max(40).nullable().optional(),
  google_parent: z.string().regex(DRIVE_ID_RE).nullable().optional(),
});

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const body = p.data;
  // Same abuse damping as the Storage init endpoint: each call mints a live
  // Google session URI.
  if (rateLimited(`resumable-init:${me.id}`, 30)) {
    return Response.json({ error: "slow down — too many upload inits" }, { status: 429 });
  }
  const db = adminClient();
  if (body.folder) {
    const dst = await folderUsable(db, me, body.folder);
    if (!dst.ok) return Response.json({ error: dst.reason ?? "not allowed" }, { status: 403 });
  }
  // No Supabase, no fallback: a drive is mandatory, not optional.
  const want = body.drive_account === undefined ? "auto" : body.drive_account || null;
  if (!want) {
    return Response.json({ error: "no destination — pick a Google Drive first" }, { status: 400 });
  }
  // Explicit pin: fail fast and cheap (fresh, uncached) before quota probes
  // burn live Google calls.
  if (want !== "auto") {
    const chk = await requireActiveAccount(want);
    if ("error" in chk) return Response.json({ error: chk.error }, { status: chk.status });
  }
  const pick = await pickUploadAccount(body.size, want === "auto" ? null : want);
  if (!pick.account) {
    return Response.json({ error: pick.reason ?? "no drive available" }, { status: 502 });
  }
  // The picked drive may have been disabled between the pin check and the
  // quota probe — re-verify fresh right before minting the session.
  const fresh = await requireActiveAccount(pick.account.id);
  if ("error" in fresh) return Response.json({ error: fresh.error }, { status: fresh.status });
  // A caller-supplied parent must sit inside the target's scope (or be the
  // scope root itself) — never smuggle bytes elsewhere.
  const scopeRoot = pick.account.root_id ?? null;
  if (body.google_parent && scopeRoot && body.google_parent !== scopeRoot) {
    if (!(await googleInScope(db, await getAccounts(), pick.account.id, body.google_parent))) {
      return Response.json({ error: "destination folder is outside this drive's shared scope" }, { status: 403 });
    }
  }
  try {
    const d = clientFor(pick.account);
    if (!d) throw new Error("google not configured");
    const root = await rootFor(d, pick.account.root_id ?? "");
    const parents = body.google_parent ? [body.google_parent] : root.kind === "folder" ? [root.id] : undefined;
    const token = await accountAccessToken(pick.account.id);
    const sessionUri = await initiateResumableSession(token, {
      name: body.name, mime: body.mime ?? "application/octet-stream", size: body.size, parents,
    });
    const parentUsed = parents?.[0] ?? null;
    return Response.json({
      ok: true, sessionUri, accountId: pick.account.id,
      accountLabel: pick.account.label, parentUsed, size: body.size,
    });
  } catch (e) {
    return Response.json({ error: googleErrorMessage(e instanceof Error ? e.message : "google upload failed") }, { status: 502 });
  }
}
