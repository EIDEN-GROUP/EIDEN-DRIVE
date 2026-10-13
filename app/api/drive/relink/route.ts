export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { clientFor, requireActiveAccount, driveBlockedResponse, activeDriveCheckEnabled, getAccounts } from "@/lib/drive-accounts";
import { googleInScope, bustScopeCache } from "@/lib/visibility";
import { parseJson } from "@/lib/http";

// ── pending_relink ────────────────────────────────────────────────
// Pre-multi-account leftovers: rows carrying a google_file_id but no
// drive_account_id. No drive can stream, trash, scope or reconcile them, so
// with active_drive_check on every drive-touching op refuses them with
// code "pending_relink" (409) instead of guessing a drive.
//
// This route is the single cleanup flow (admins only):
//   GET  → list pending rows + counts + review deadline
//   POST → one of three explicit actions per row:
//     relink { file_id, accountId }  attach to a live drive (verified live
//                                    + in scope first — never blind)
//     unpin  { file_id }             hybrids only: keep Storage bytes, drop
//                                    the Google pin (becomes local-only)
//     delete { file_id }             pure orphans only: detach history and
//                                    delete the row (Drive bytes untouched)
// The review deadline is explicit in every GET response (30 days from the
// call); every action writes an audit entry. Nothing here touches prod data
// beyond the rows the manager explicitly names.
const RELINK_REVIEW_DAYS = 30;

const Action = z.object({
  action: z.enum(["relink", "unpin", "delete"]),
  file_id: z.string().uuid(),
  accountId: z.string().uuid().optional(),
});

export async function GET() {
  const me = await getProfile();
  if (!me || !can(me.role, "admin-only")) return Response.json({ error: "admins only", code: "forbidden" }, { status: 403 });
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const { data, error } = await db.from("file_index")
    .select("id,name,mime,size,google_file_id,storage_path,backends,owner")
    .is("drive_account_id", null).not("google_file_id", "is", null)
    .order("name").limit(500);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as { id: string; name: string; mime: string; size: number; google_file_id: string; storage_path: string | null }[];
  const pure = rows.filter((r) => !r.storage_path).length;
  const reviewBy = new Date(Date.now() + RELINK_REVIEW_DAYS * 86400_000).toISOString();
  return Response.json({
    ok: true,
    pending: rows,
    counts: { total: rows.length, pure_orphans: pure, hybrids: rows.length - pure },
    review_by: reviewBy,
    review_note: `decide relink / unpin / delete for each row by ${reviewBy.slice(0, 10)} — until then these rows refuse every drive operation with code pending_relink`,
    check_on: await activeDriveCheckEnabled(),
  });
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "admin-only")) return Response.json({ error: "admins only", code: "forbidden" }, { status: 403 });
  const p = await parseJson(req, Action);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const { data: row } = await db.from("file_index")
    .select("id,name,mime,google_file_id,google_parent_id,storage_path,backends").eq("id", p.data.file_id).maybeSingle();
  const f = row as { id: string; name: string; mime: string; google_file_id: string | null; google_parent_id: string | null; storage_path: string | null; backends: string[] } | null;
  if (!f || !f.google_file_id) return Response.json({ error: "not a pending_relink row", code: "not_pending" }, { status: 404 });

  if (p.data.action === "relink") {
    if (!p.data.accountId) return Response.json({ error: "relink needs accountId", code: "bad_request" }, { status: 400 });
    const gate = await requireActiveAccount(p.data.accountId);
    if ("error" in gate) return driveBlockedResponse(gate);
    const d = clientFor(gate.account);
    if (!d) return Response.json({ error: "google not configured", code: "google_failed" }, { status: 502 });
    // Verify the file REALLY lives in that account (live read, never trust
    // the stale pin) and sits inside its shared scope.
    try {
      await d.files.get({ fileId: f.google_file_id, fields: "id", supportsAllDrives: true });
    } catch {
      return Response.json({ error: `“${f.name}” isn't in the “${gate.account.label}” drive — pick the drive that actually holds it`, code: "not_in_drive" }, { status: 409 });
    }
    if (!(await googleInScope(db, await getAccounts(), p.data.accountId, f.google_file_id))) {
      return Response.json({ error: "that file sits outside this drive's shared scope — re-scope the drive first", code: "out_of_scope" }, { status: 403 });
    }
    const { error } = await db.from("file_index").update({ drive_account_id: p.data.accountId }).eq("id", f.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    bustScopeCache(p.data.accountId);
    await logAudit({ actor: me.id, actor_name: me.username, action: "edit", file_id: f.id, req, detail: { relinked_to: p.data.accountId } });
    return Response.json({ ok: true, id: f.id, accountId: p.data.accountId });
  }

  if (p.data.action === "unpin") {
    if (!f.storage_path) {
      return Response.json({ error: "pure orphans have no Storage copy to keep — delete the row instead", code: "not_hybrid" }, { status: 400 });
    }
    const backends = (f.backends ?? []).filter((b) => b !== "google");
    const { error } = await db.from("file_index")
      .update({ google_file_id: null, google_parent_id: null, drive_account_id: null, backends: backends.length ? backends : ["local"] })
      .eq("id", f.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await logAudit({ actor: me.id, actor_name: me.username, action: "edit", file_id: f.id, req, detail: { unpinned_legacy_google: true } });
    return Response.json({ ok: true, id: f.id, now_local_only: true });
  }

  // delete: pure orphans only. History detaches first (no cascade), Drive
  // bytes are never touched — this only drops FileOS's stale pointer.
  if (f.storage_path) {
    return Response.json({ error: "this row still has a Storage copy — unpin it instead of deleting", code: "has_storage" }, { status: 400 });
  }
  await db.from("audit_logs").update({ file_id: null }).eq("file_id", f.id);
  await db.from("approvals").delete().eq("file_id", f.id);
  await db.from("recovery_bin").delete().eq("file_id", f.id);
  const { error } = await db.from("file_index").delete().eq("id", f.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "perm-delete", req, detail: { pending_relink_cleared: f.name } });
  return Response.json({ ok: true, deleted: f.id });
}
