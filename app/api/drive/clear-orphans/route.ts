export const dynamic = "force-dynamic";

import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { purgeOrphanGoogleRows, bustAccountCache, getAccounts } from "@/lib/drive-accounts";

// Managers+: delete pre-multi-account Google leftovers (google pin, no
// account) that no drive can own, stream or scope — the rows behind the
// Explorer's orphan notice. Storage bytes are kept (hybrids lose the pin);
// Drive bytes are never touched. Next step is always "Sync from Google".
// Refuses when NO drive is scoped: on an unscoped (whole-drive) setup those
// rows have no "previous location" and may be the only index of live files.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const scopedAny = (await getAccounts()).some((a) => a.status === "active" && a.root_id);
  if (!scopedAny) {
    return Response.json({ error: "no scoped drive — orphans only exist once a drive is scoped to a folder" }, { status: 400 });
  }
  try {
    const r = await purgeOrphanGoogleRows(adminClient());
    bustAccountCache();
    const { bustScopeCache } = await import("@/lib/visibility");
    bustScopeCache();
    await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { orphans_cleared: r.deleted, orphans_unpinned: r.unpinned } });
    return Response.json({ ok: true, ...r, next: "run Sync from Google to rebuild the index inside the current scope" });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "clear failed" }, { status: 500 });
  }
}
