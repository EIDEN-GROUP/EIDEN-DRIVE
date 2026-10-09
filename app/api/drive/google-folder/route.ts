export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { driveCtxFor, getAccounts } from "@/lib/drive-accounts";
import { rootFor } from "@/lib/google-drive";
import { googleErrorMessage } from "@/lib/errors";
import { googleInScope, bustScopeCache } from "@/lib/visibility";
import { parseJson } from "@/lib/http";

const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const Body = z.object({
  accountId: z.string().uuid(),
  // Google folder to create inside. Omitted = the account's scope root
  // (or My Drive root when unscoped).
  parentId: z.string().regex(DRIVE_ID).nullable().optional(),
  name: z.string().trim().min(1).max(120),
});

// Folders created while browsing a Google drive view: a REAL Drive folder
// (not a local workspace row), indexed immediately so the tree shows it
// without waiting for Sync. Same rule as local folders: any signed-in member.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const ctx = await driveCtxFor(p.data.accountId);
  if (!ctx?.drive) return Response.json({ error: "drive not available" }, { status: 404 });
  const db = adminClient();
  const accounts = await getAccounts();
  const acct = accounts.find((a) => a.id === p.data.accountId);
  const scopeRoot = acct?.root_id ?? null;
  // Never create outside a scoped tree: the parent must be the scope root
  // itself or sit inside it. Unscoped accounts accept any parent.
  if (p.data.parentId && scopeRoot && p.data.parentId !== scopeRoot) {
    if (!(await googleInScope(db, accounts, p.data.accountId, p.data.parentId))) {
      return Response.json({ error: "outside this drive's shared scope" }, { status: 403 });
    }
  }
  try {
    const root = await rootFor(ctx.drive, ctx.rootId);
    const parents = p.data.parentId
      ? [p.data.parentId]
      : root.kind === "folder" ? [root.id] : undefined;
    const created = await ctx.drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: p.data.name,
        mimeType: "application/vnd.google-apps.folder",
        ...(parents ? { parents } : {}),
      },
      fields: "id",
    });
    const googleId = created.data.id;
    if (!googleId) throw new Error("google create returned no id");
    const parentUsed = parents?.[0] ?? null;
    const { data, error } = await db.from("file_index").insert({
      name: p.data.name,
      mime: "application/vnd.google-apps.folder",
      size: 0,
      google_file_id: googleId,
      google_parent_id: parentUsed,
      drive_account_id: p.data.accountId,
      backends: ["google"],
      owner: me.id,
    }).select("id").single();
    if (error) throw new Error(error.message);
    await db.from("versions").insert({ file_id: data.id, v: 1, hash: "", actor: me.id });
    bustScopeCache(p.data.accountId);
    await logAudit({ actor: me.id, actor_name: me.username, action: "add", file_id: data.id, req, detail: { google_folder: googleId, account: p.data.accountId } });
    return Response.json({ ok: true, id: data.id, googleId }, { status: 201 });
  } catch (e) {
    return Response.json({ error: googleErrorMessage(e instanceof Error ? e.message : "folder create failed") }, { status: 502 });
  }
}
