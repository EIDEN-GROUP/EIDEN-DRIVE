export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { deleteDriveFile } from "@/lib/google-drive";
import { driveCtxFor } from "@/lib/drive-accounts";
import { UPLOAD_BUCKET } from "@/lib/storage";
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

  const { data: f } = await db.from("file_index").select("id,name,size,hash,storage_path,google_file_id,drive_account_id").eq("id", file_id).maybeSingle();
  if (!f) return Response.json({ error: "file not found" }, { status: 404 });
  const { data: inBin } = await db.from("recovery_bin").select("file_id").eq("file_id", file_id).maybeSingle();
  if (!inBin) return Response.json({ error: "only files in the Recovery Bin can be deleted permanently" }, { status: 409 });

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
  // 2) then our own Storage copy. Every step tolerates "already gone", so a retry after a partial failure just finishes the job.
  if (f.storage_path) {
    const { error } = await db.storage.from(UPLOAD_BUCKET).remove([f.storage_path]);
    if (error && !gone(error.message)) return Response.json({ error: `Storage delete failed: ${error.message} (safe to retry)` }, { status: 502 });
  }

  await db.from("approvals").delete().eq("file_id", file_id);
  await db.from("audit_logs").update({ file_id: null }).eq("file_id", file_id); // FK has no cascade; history stays, detached
  await db.from("recovery_bin").delete().eq("file_id", file_id);
  const { error } = await db.from("file_index").delete().eq("id", file_id); // versions + tags cascade
  if (error) return Response.json({ error: `Bytes were erased but the index row could not be removed: ${error.message}` }, { status: 500 });

  await logAudit({ actor: me.id, actor_name: me.username, action: "perm-delete", req, detail: { name: f.name, size: f.size, hash: f.hash, purged: true } });
  return Response.json({ ok: true });
}
