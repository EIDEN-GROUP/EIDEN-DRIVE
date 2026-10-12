export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { clientFor, getAccounts, requireActiveAccount } from "@/lib/drive-accounts";
import { deleteDriveFile, rootFor } from "@/lib/google-drive";
import { googleErrorMessage } from "@/lib/errors";
import { notifyUpload } from "@/lib/upload-notify";
import { folderUsable, googleInScope, bustScopeCache } from "@/lib/visibility";
import { DRIVE_ID_RE, RESUMABLE_MAX } from "@/lib/resumable";
import { parseJson } from "@/lib/http";

// Step 2 of direct-to-Google resumable upload: the browser finished PUTting
// chunks straight to Google. Verify the landed file against the live Drive
// record (never the client's word for it), then index it exactly like a
// direct upload. Supabase Storage is never touched on this path.
//
// The client's claims are limited to routing (which session's file, which
// workspace folder, its own hash): name/mime/size/parents come from Google.
const Body = z.object({
  driveFileId: z.string().regex(DRIVE_ID_RE),
  accountId: z.string().uuid(),
  folder: z.string().uuid().nullable().optional(),
  hash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const body = p.data;
  const db = adminClient();
  // Fresh gate: the drive may have been disabled during the (possibly long)
  // chunk transfer. Refuse to index content on a dead drive.
  const gate = await requireActiveAccount(body.accountId);
  if ("error" in gate) return Response.json({ error: gate.error }, { status: gate.status });
  const d = clientFor(gate.account);
  if (!d) return Response.json({ error: "google not configured" }, { status: 502 });
  // Best-effort removal of a Drive file we refuse to index, so failures can't
  // leave invisible orphans. Never fails the request itself.
  const dropStray = async (id: string) => {
    try { await deleteDriveFile(id, d); } catch { /* ignore */ }
  };
  // Read the landed file from Google — the authority on name/size/parents.
  let g: { id?: string; name?: string; mimeType?: string; size?: string; parents?: string[] };
  try {
    const meta = await d.files.get({
      fileId: body.driveFileId, fields: "id,name,mimeType,size,parents", supportsAllDrives: true,
    });
    g = (meta.data ?? {}) as typeof g;
    if (!g.id) throw new Error("google returned no file");
  } catch {
    return Response.json({ error: "upload not found in Drive — retry the upload" }, { status: 400 });
  }
  const size = Number(g.size ?? 0);
  if (!size || size > RESUMABLE_MAX || !Number.isSafeInteger(size)) {
    await dropStray(body.driveFileId);
    return Response.json({ error: "uploaded file looks wrong (size) — it was removed, retry the upload" }, { status: 400 });
  }
  // Scope: the landed file must sit inside the account's shared scope.
  const accs = await getAccounts();
  if (!(await googleInScope(db, accs, body.accountId, body.driveFileId))) {
    await dropStray(body.driveFileId);
    return Response.json({ error: "upload landed outside this drive's shared scope — it was removed" }, { status: 403 });
  }
  // Parent check: on a folder-scoped drive the file must sit under the scope
  // root (the init step bound the session there); unscoped drives accept any.
  try {
    const root = await rootFor(d, gate.account.root_id ?? "");
    const parents = g.parents ?? [];
    if (root.kind === "folder" && !parents.includes(root.id)) {
      await dropStray(body.driveFileId);
      return Response.json({ error: "upload landed outside the expected folder — it was removed, retry" }, { status: 400 });
    }
  } catch (e) {
    await dropStray(body.driveFileId);
    return Response.json({ error: googleErrorMessage(e instanceof Error ? e.message : "couldn't verify the upload") }, { status: 502 });
  }
  // Department permissions may have changed mid-upload — re-check placement.
  if (body.folder) {
    const dst = await folderUsable(db, me, body.folder);
    if (!dst.ok) {
      await dropStray(body.driveFileId);
      return Response.json({ error: dst.reason ?? "not allowed" }, { status: 403 });
    }
  }
  const { data, error } = await db.from("file_index").insert({
    name: g.name ?? "?", mime: g.mimeType ?? "application/octet-stream", size,
    hash: body.hash ?? null, backends: ["google"], owner: me.id, folder: body.folder ?? null,
    storage_path: null, google_file_id: g.id, google_parent_id: (g.parents ?? [])[0] ?? null,
    drive_account_id: body.accountId,
  }).select("id").single();
  if (error) {
    await dropStray(body.driveFileId);
    return Response.json({ error: error.message }, { status: 500 });
  }
  await db.from("versions").insert({ file_id: data.id, v: 1, hash: body.hash ?? "", actor: me.id });
  bustScopeCache(body.accountId);
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", file_id: data.id, req, detail: { backends: ["google"], resumable: true } });
  await notifyUpload(db, req, { fileId: data.id, name: g.name ?? "?", size, folderId: body.folder, userId: me.id, username: me.username });
  return Response.json({ ok: true, id: data.id });
}
