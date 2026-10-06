export const dynamic = "force-dynamic";

import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { storageAlert } from "@/lib/alerts";
import { getAboutQuota } from "@/lib/google-drive";

// Live: Google quota when configured, latest agent heartbeat, recent backup jobs.
export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const quota = await getAboutQuota().catch(() => null);
  const google = quota
    ? { used: quota.usage, total: quota.limit }
    : { used: 0, total: 0, unconfigured: true };
  let jobs: unknown[] = [];
  let agentMin: number | null = null;
  if (hasAdminClient()) {
    const db = adminClient();
    const { data } = await db.from("jobs").select("kind,status,created_at,payload").order("created_at", { ascending: false }).limit(10);
    jobs = data ?? [];
    const hb = (data ?? []).find((j: { kind: string }) => j.kind === "agent-heartbeat") as { created_at: string } | undefined;
    agentMin = hb ? Math.round((Date.now() - new Date(hb.created_at).getTime()) / 60000) : null;
  }
  return Response.json({
    google: { ...google, alert: google.total ? storageAlert(google.used, google.total) : null },
    jobs,
    agent: { heartbeat_min_ago: agentMin, online: agentMin !== null && agentMin < 10 }
  });
}

// Managers+: trigger an on-demand backup verification job (agent picks it up).
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const { data, error } = await db.from("jobs").insert({ kind: "backup-verify", status: "pending", payload: { by: me.username } }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", req, detail: { job: "backup-verify" } });
  return Response.json({ ok: true, id: data.id }, { status: 201 });
}
