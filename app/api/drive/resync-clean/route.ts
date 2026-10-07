export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { bustAccountCache } from "@/lib/drive-accounts";
import { parseJson } from "@/lib/http";

const Body = z.object({ accountId: z.string().uuid() });

// Managers+: "resync clean" for one drive. Drops that account's Google-mirrored
// index rows (pure mirrors are deleted; rows that ALSO have a Storage copy keep
// the copy and lose the Google pin), so the next Sync rebuilds the tree from
// the drive's current truth — no ghosts, no stale folders.
// Use after re-scoping a root, or whenever the index disagrees with Drive.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const { data: acct } = await db.from("drive_accounts").select("id,label").eq("id", p.data.accountId).maybeSingle();
  if (!acct) return Response.json({ error: "drive not found" }, { status: 404 });

  // Collect the account's pure-mirror row ids (chunked — drives can hold 10k+).
  const targetIds: string[] = [];
  for (let off = 0; ; off += 1000) {
    const { data: chunk, error: cErr } = await db.from("file_index").select("id")
      .eq("drive_account_id", p.data.accountId)
      .not("google_file_id", "is", null)
      .is("storage_path", null)
      .range(off, off + 999);
    if (cErr) return Response.json({ error: cErr.message }, { status: 500 });
    if (!chunk?.length) break;
    targetIds.push(...chunk.map((c: { id: string }) => c.id));
    if (chunk.length < 1000) break;
  }
  // FK-safe order, 200 per statement: dependents first (recovery_bin and
  // approvals reference file_index without cascade; versions cascades itself).
  for (let i = 0; i < targetIds.length; i += 200) {
    const inList = targetIds.slice(i, i + 200);
    const { error: bErr } = await db.from("recovery_bin").delete().in("file_id", inList);
    if (bErr) return Response.json({ error: bErr.message }, { status: 500 });
    const { error: aErr } = await db.from("approvals").delete().in("file_id", inList);
    if (aErr) return Response.json({ error: aErr.message }, { status: 500 });
    const { error: dErr } = await db.from("file_index").delete().in("id", inList);
    if (dErr) return Response.json({ error: dErr.message }, { status: 500 });
  }
  const deleted = targetIds.length;

  // Hybrid rows (Storage copy + Google pin): keep bytes, drop the Google pin.
  const { data: hybrid } = await db.from("file_index").select("id,backends")
    .eq("drive_account_id", p.data.accountId)
    .not("storage_path", "is", null);
  let unpinned = 0;
  for (const h of (hybrid ?? []) as { id: string; backends: string[] }[]) {
    const backends = (h.backends ?? []).filter((b) => b !== "google");
    await db.from("file_index").update({ google_file_id: null, google_parent_id: null, drive_account_id: null, backends: backends.length ? backends : ["local"] }).eq("id", h.id);
    unpinned++;
  }
  bustAccountCache();
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { drive_resync_clean: p.data.accountId, deleted, unpinned } });
  return Response.json({ ok: true, deleted, unpinned, next: "run Sync from Google to rebuild this drive's index" });
}
