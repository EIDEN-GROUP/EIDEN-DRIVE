export const dynamic = "force-dynamic";

import { z } from "zod";
import { hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { activeDriveCheckEnabled, setActiveDriveCheck, bustSettingsCache } from "@/lib/drive-accounts";
import { parseJson } from "@/lib/http";

// Storage-admin toggle for the active_drive_check gate (migration 0019).
// Default ON. Turning it OFF restores pre-migration legacy behavior verbatim
// (env-token Primary auto-import, env fallbacks, legacy sync) — only for a
// storage admin who knows the old drive is intentionally unmigrated.
const Patch = z.object({ value: z.boolean() });

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ ok: true, active_drive_check: await activeDriveCheckEnabled(), canManage: can(me.role, "manage-users") });
}

export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Patch);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  try {
    await setActiveDriveCheck(p.data.value);
  } catch (e) {
    return Response.json({ error: `couldn't save the setting (is migration 0019 applied?): ${e instanceof Error ? e.message : "unknown"}` }, { status: 500 });
  }
  bustSettingsCache();
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { active_drive_check: p.data.value } });
  return Response.json({ ok: true, active_drive_check: p.data.value });
}
