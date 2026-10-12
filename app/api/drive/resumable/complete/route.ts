export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { clientFor, requireActiveAccount, driveBlockedResponse, quotaFor } from "@/lib/drive-accounts";
import { deleteDriveFile, rootFor } from "@/lib/google-drive";
import { googleErrorMessage } from "@/lib/errors";
import { notifyUpload } from "@/lib/upload-notify";
import { folderUsable, landedFileInScope, bustScopeCache } from "@/lib/visibility";
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
  if ("error" in gate) return driveBlockedResponse(gate);
  const d = clientFor(gate.account);
  if (!d) return Response.json({ error: "google not configured" }, { status: 502 });
  // Idempotency first: a retried complete (double-click, reconcile-then-
  // complete race) must return the existing row, never a duplicate index row
  // for the same Drive file. Checked BEFORE any Drive read.
  {
    const { data: dup } = await db.from("file_index").select("id").eq("google_file_id", body.driveFileId).eq("drive_account_id", body.accountId).maybeSingle();
    if (dup) return Response.json({ ok: true, id: (dup as { id: string }).id, deduped: true });
  }
  // Best-effort removal of a Drive file we refuse to index, so failures can't
  // leave invisible orphans. Never fails the request itself — but a failed
  // cleanup is WARN-logged server-side (never silently ignored): an unremoved
  // file resurfaces on the next Sync, and the log tells whose it was.
  const dropStray = async (id: string): Promise<boolean> => {
    try {
      await deleteDriveFile(id, d);
      return true;
    } catch (e) {
      console.warn(`[upload-cleanup] couldn't remove refused Drive file ${id} (account ${body.accountId}): ${e instanceof Error ? e.message : e}`);
      return false;
    }
  };
  // Read the landed file from Google — the authority on name/size/parents.
  // driveId + trashed ride along: the scope check needs the former, and a
  // trashed landing (user trashed it mid-upload, or a colliding session did)
  // must not be indexed as a live file.
  let g: { id?: string; name?: string; mimeType?: string; size?: string; parents?: string[]; driveId?: string; trashed?: boolean };
  try {
    const meta = await d.files.get({
      fileId: body.driveFileId, fields: "id,name,mimeType,size,parents,driveId,trashed", supportsAllDrives: true,
    });
    g = (meta.data ?? {}) as typeof g;
    if (!g.id) throw new Error("google returned no file");
  } catch {
    return Response.json({ error: "upload not found in Drive — retry the upload", code: "not_in_drive" }, { status: 400 });
  }
  if (g.trashed) {
    await dropStray(body.driveFileId);
    return Response.json({ error: "upload was trashed in Drive before registration — retry the upload", code: "trashed_in_drive" }, { status: 400 });
  }
  const size = Number(g.size ?? 0);
  if (!size || size > RESUMABLE_MAX || !Number.isSafeInteger(size)) {
    await dropStray(body.driveFileId);
    return Response.json({ error: "uploaded file looks wrong (size) — it was removed, retry the upload", code: "bad_size" }, { status: 400 });
  }
  // Scope + destination in ONE live check. The file has no index row yet, so
  // the index-derived googleInScope() would false-positive on EVERY valid
  // upload (its set is built from file_index rows). Instead validate live
  // Drive ancestry: folder roots accept root-level AND nested landings,
  // shared-drive roots require the same drive, My Drive accepts. Truly
  // out-of-scope files are still refused AND removed.
  let root: { kind: "drive"; id: string } | { kind: "folder"; id: string } | { kind: "mydrive" };
  try {
    root = await rootFor(d, gate.account.root_id ?? "");
  } catch (e) {
    await dropStray(body.driveFileId);
    return Response.json({ error: googleErrorMessage(e instanceof Error ? e.message : "couldn't verify the upload"), code: "google_failed" }, { status: 502 });
  }
  const scope = await landedFileInScope(d, root, { id: g.id, parents: g.parents, driveId: g.driveId });
  if (!scope.ok) {
    const cleaned = await dropStray(body.driveFileId);
    return Response.json({
      error: cleaned ? scope.reason : `${scope.reason} (cleanup failed too — the file may still sit in Drive; it will surface on the next Sync for manual removal)`,
      code: "out_of_scope",
    }, { status: 403 });
  }
  // Department permissions may have changed mid-upload — re-check placement.
  if (body.folder) {
    const dst = await folderUsable(db, me, body.folder);
    if (!dst.ok) {
      await dropStray(body.driveFileId);
      return Response.json({ error: dst.reason ?? "not allowed", code: "folder_forbidden" }, { status: 403 });
    }
  }
  const { data, error } = await db.from("file_index").insert({
    name: g.name ?? "?", mime: g.mimeType ?? "application/octet-stream", size,
    hash: body.hash ?? null, backends: ["google"], owner: me.id, folder: body.folder ?? null,
    storage_path: null, google_file_id: g.id, google_parent_id: (g.parents ?? [])[0] ?? null,
    drive_account_id: body.accountId,
  }).select("id").single();
  if (error) {
    // Concurrent duplicate complete (reconcile-then-complete race, double
    // submit): the unique (google_file_id, drive_account_id) index won
    // elsewhere. Re-read — if the row exists now, return it WITHOUT deleting
    // anything (that Drive file is legitimately indexed). Only a genuinely
    // unindexed file is removed as stray.
    const { data: raced } = await db.from("file_index").select("id").eq("google_file_id", body.driveFileId).eq("drive_account_id", body.accountId).maybeSingle();
    if (raced) return Response.json({ ok: true, id: (raced as { id: string }).id, deduped: true });
    await dropStray(body.driveFileId);
    return Response.json({ error: error.message, code: "index_failed" }, { status: 500 });
  }
  await db.from("versions").insert({ file_id: data.id, v: 1, hash: body.hash ?? "", actor: me.id });
  bustScopeCache(body.accountId);
  // Per-drive audit: account + scope root + post-upload quota, so Storage
  // audits answer "which drive, how full" without aggregates.
  let quotaAfter: { usage: number | null; limit: number | null; free: number | null } | null = null;
  try {
    const q = await quotaFor(gate.account);
    quotaAfter = { usage: q.usage, limit: q.limit, free: q.free };
  } catch { /* quota is advisory; the upload already landed */ }
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", file_id: data.id, req, detail: { backends: ["google"], resumable: true, account: body.accountId, scope_root_id: gate.account.root_id ?? null, quota_after: quotaAfter, size } });
  await notifyUpload(db, req, { fileId: data.id, name: g.name ?? "?", size, folderId: body.folder, userId: me.id, username: me.username });
  return Response.json({ ok: true, id: data.id });
}
