export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { clientFor, requireActiveAccount, driveBlockedResponse } from "@/lib/drive-accounts";
import { rateLimited } from "@/lib/rate";
import { DRIVE_ID_RE, RESUMABLE_MAX } from "@/lib/resumable";
import { parseJson } from "@/lib/http";

// Reconcile a finalize-unknown resumable upload. Background: Google's final
// 200 (complete) response carries no CORS headers, so a browser can PUT every
// byte successfully yet be unable to read the completion — indistinguishable
// at XHR level from a network failure. Instead of guessing (retry → duplicate,
// or fail → "lost" file that actually landed), the client asks here: did a
// file with exactly this name+size land in the expected parent since the
// session started? Fully server-side, hence CORS-free and authoritative.
const Body = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(RESUMABLE_MAX),
  parentUsed: z.string().regex(DRIVE_ID_RE).nullable().optional(),
  startedAfter: z.string().datetime({ offset: true }),
});

interface DriveHit { id?: string; name?: string; size?: string; parents?: string[]; createdTime?: string }

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  if (rateLimited(`resumable-reconcile:${me.id}`, 30)) {
    return Response.json({ error: "slow down — too many requests" }, { status: 429 });
  }
  const body = p.data;
  const gate = await requireActiveAccount(body.accountId);
  if ("error" in gate) return driveBlockedResponse(gate);
  const d = clientFor(gate.account);
  if (!d) return Response.json({ error: "google not configured" }, { status: 502 });
  // Drive query escaping: backslash + single quote.
  const escName = body.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  let q = `name = '${escName}' and trashed = false`;
  if (body.parentUsed) q += ` and '${body.parentUsed}' in parents`;
  try {
    const res = await d.files.list({
      q,
      fields: "files(id,name,size,parents,createdTime)",
      orderBy: "createdTime desc",
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const since = new Date(body.startedAfter).getTime() - 60_000; // clock-skew slack
    const hits = ((res.data.files ?? []) as DriveHit[]).filter(
      (f) => Number(f.size ?? -1) === body.size && new Date(f.createdTime ?? 0).getTime() >= since
    );
    if (!hits.length) return Response.json({ ok: true, found: null });
    if (hits.length > 1) {
      return Response.json(
        { error: "several matching files landed in Drive — open the folder and keep the right one before retrying" },
        { status: 409 }
      );
    }
    const f = hits[0];
    return Response.json({ ok: true, found: { id: f.id, name: f.name, size: Number(f.size) } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "couldn't check Drive" }, { status: 502 });
  }
}
