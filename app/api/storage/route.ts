export const dynamic = "force-dynamic";

import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { storageAlert } from "@/lib/alerts";
import { getAboutQuota } from "@/lib/google-drive";
import { getAccounts, quotaFor, rootKind, clientFor, type DriveAccount } from "@/lib/drive-accounts";

// Live: per-account Google quotas when connected, latest agent heartbeat, recent jobs.
export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const accounts = await getAccounts() as (DriveAccount & { refresh_token: string })[];
  const drives = [];
  if (accounts.some((a) => a.status === "active")) {
    for (const a of accounts) {
      if (a.status !== "active") {
        drives.push({ id: a.id, label: a.label, email: a.email, status: a.status, used: 0, total: 0 });
        continue;
      }
      try {
        const q = await quotaFor(a);
        const d = clientFor(a);
        const kind = d ? (await rootKind(d, a.root_id ?? "")).kind : "mydrive";
        drives.push({
          id: a.id, label: a.label, email: q.email ?? a.email, status: "active", rootKind: kind,
          used: q.usage ?? 0, total: q.limit ?? 0,
          alert: q.usage !== null && q.limit ? storageAlert(q.usage, q.limit) : null
        });
      } catch {
        drives.push({ id: a.id, label: a.label, email: a.email, status: "down", used: 0, total: 0 });
      }
    }
  } else {
    const quota = await getAboutQuota().catch(() => null);
    drives.push(quota
      ? { id: "legacy", label: "Primary", email: null, status: "active", used: quota.usage, total: quota.limit, alert: storageAlert(quota.usage, quota.limit) }
      : { id: "legacy", label: "Primary", email: null, status: "unconfigured", used: 0, total: 0 });
  }
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
    drives,
    google: drives[0] ? { used: drives[0].used, total: drives[0].total, alert: (drives[0] as { alert?: string | null }).alert ?? null } : { used: 0, total: 0, unconfigured: true },
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
