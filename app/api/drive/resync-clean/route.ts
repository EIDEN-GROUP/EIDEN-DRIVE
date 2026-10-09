export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { bustAccountCache, purgeAccountRows } from "@/lib/drive-accounts";
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
  const { data: acct } = await db.from("drive_accounts").select("id,label,root_id").eq("id", p.data.accountId).maybeSingle();
  if (!acct) return Response.json({ error: "drive not found" }, { status: 404 });

  let deleted = 0, unpinned = 0;
  try {
    // Orphan sweep only on scoped drives: on an unscoped (whole-drive) account
    // account-less rows may be the only index of live files.
    ({ deleted, unpinned } = await purgeAccountRows(db, p.data.accountId, {
      sweepOrphans: (acct as { root_id?: string | null }).root_id != null,
    }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "clean failed" }, { status: 500 });
  }
  bustAccountCache();
  const { bustScopeCache } = await import("@/lib/visibility");
  bustScopeCache(p.data.accountId);
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { drive_resync_clean: p.data.accountId, deleted, unpinned } });
  return Response.json({ ok: true, deleted, unpinned, next: "run Sync from Google to rebuild this drive's index" });
}
