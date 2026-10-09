export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { deleteDriveFile } from "@/lib/google-drive";
import { driveCtxFor } from "@/lib/drive-accounts";
import { bucketFor } from "@/lib/storage";
import { googleDescendants, bustScopeCache } from "@/lib/visibility";
import { parseJson } from "@/lib/http";

const Body = z.object({ file_id: z.string().uuid() });
const gone = (m: string) => /not.?found|404|no such/i.test(m);

// PERMANENT delete of a file that is already in the Recovery Bin. Managers and admins only.
// Order matters: bytes first (Google, then Storage — a failure aborts before any database row is touched and is safe
// to retry), then the database rows. audit_logs / approvals / recovery_bin reference file_index without a cascade,
// so they are detached explicitly; the audit trail keeps a "perm-delete" entry with the name, size and hash.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "perm-delete")) return Response.json({ error: "managers and admins only" }, { status: 403 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const { file_id } = p.data;
  const db = adminClient();

  const { data: f } = await db.from("file_index").select("id,name,mime,size,hash,storage_path,storage_bucket,google_file_id,drive_account_id").eq("id", file_id).maybeSingle();
  if (!f) return Response.json({ error: "file not found" }, { status: 404 });
  const { data: inBin } = await db.from("recovery_bin").select("file_id").eq("file_id", file_id).maybeSingle();
  if (!inBin) return Response.json({ error: "only files in the Recovery Bin can be deleted permanently" }, { status: 409 });
  const fr = f as { mime?: string; drive_account_id?: string | null; google_file_id?: string | null };
  // Purging a Google folder purges its whole indexed subtree with it: Drive
  // deletes folders recursively, so index rows left behind would be ghosts.
  let extraIds: string[] = [];
  if (fr.mime === "application/vnd.google-apps.folder" && fr.drive_account_id && fr.google_file_id) {
    extraIds = await googleDescendants(db, fr.drive_account_id, String(fr.google_file_id));
  }
  const allIds = [file_id, ...extraIds.filter((id) => id !== file_id)];

  // 1) Google first (the step most likely to fail) — and refuse up front if its account can't be reached.
  if (f.google_file_id) {
    const ctx = await driveCtxFor((f as { drive_account_id?: string | null }).drive_account_id);
    if (!ctx?.drive) return Response.json({ error: "Can't reach the Google account that holds this file — reconnect it, then try again (nothing was deleted)." }, { status: 502 });
    try { await deleteDriveFile(String(f.google_file_id), ctx.drive); }
    catch (e) {
      const m = e instanceof Error ? e.message : "unknown";
      if (!gone(m)) return Response.json({ error: `Google delete failed: ${m} (nothing else was deleted — safe to retry)` }, { status: 502 });
    }
  }
  // 2) then our own Storage copies (the subtree may hold hybrids with bytes).
  // Every step tolerates "already gone", so a retry after a partial failure just finishes the job.
  if (extraIds.length) {
    const { data: kids } = await db.from("file_index").select("id,storage_path,storage_bucket").in("id", extraIds);
    for (const k of (kids ?? []) as { id: string; storage_path: string | null; storage_bucket: string | null }[]) {
      if (k.storage_path) {
        const { error } = await db.storage.from(bucketFor(k)).remove([k.storage_path]);
        if (error && !gone(error.message)) return Response.json({ error: `Storage delete failed: ${error.message} (safe to retry)` }, { status: 502 });
      }
    }
  }
  if (f.storage_path) {
    const { error } = await db.storage.from(bucketFor(f)).remove([f.storage_path]);
    if (error && !gone(error.message)) return Response.json({ error: `Storage delete failed: ${error.message} (safe to retry)` }, { status: 502 });
  }

  await db.from("approvals").delete().in("file_id", allIds);
  await db.from("audit_logs").update({ file_id: null }).in("file_id", allIds); // FK has no cascade; history stays, detached
  await db.from("recovery_bin").delete().in("file_id", allIds);
  const { error } = await db.from("file_index").delete().in("id", allIds); // versions + tags cascade
  if (error) return Response.json({ error: `Bytes were erased but the index rows could not be removed: ${error.message}` }, { status: 500 });
  if (fr.drive_account_id) bustScopeCache(fr.drive_account_id);

  await logAudit({ actor: me.id, actor_name: me.username, action: "perm-delete", req, detail: { name: f.name, size: f.size, hash: f.hash, purged: true, subtree: extraIds.length } });
  return Response.json({ ok: true, purged: allIds.length });
}
