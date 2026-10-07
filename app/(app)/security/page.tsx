import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { getAboutQuota } from "@/lib/google-drive";
import { storageAlert } from "@/lib/alerts";
import { formatBytes } from "@/lib/files";
import { Card } from "@/components/ui/primitives";
import SecurityView, { type SecurityData } from "@/components/dash/SecurityView";
import { actionMeta } from "@/components/dash/actions";

export const dynamic = "force-dynamic";

// Security Center — every number below is queried live. Managers and admins only:
// it names people (MFA gaps, lockouts, failed logins), which members must not see.
export default async function SecurityPage() {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) {
    return (
      <section className="px-1 pt-1">
        <h1 className="page-title mb-4">Security Center</h1>
        <Card label="Restricted">
          <p className="text-sm text-muted">The Security Center names people and is visible to managers and admins only.</p>
        </Card>
      </section>
    );
  }
  if (!hasAdminClient()) {
    return (
      <section className="px-1 pt-1">
        <h1 className="page-title mb-4">Security Center</h1>
        <Card label="Not configured"><p className="text-sm text-muted">Server is missing its service key — set SUPABASE_SERVICE_ROLE_KEY.</p></Card>
      </section>
    );
  }
  const db = adminClient();
  const twoWeeks = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  const [
    { data: profiles },
    { data: totp },
    { data: pending },
    { data: events },
    { data: recent },
    { data: jobs },
    { data: failures }
  ] = await Promise.all([
    db.from("profiles").select("username,role").limit(500),
    db.from("vault_totp").select("user_id,confirmed,locked_until,fail_count"),
    db.from("approvals").select("id,file_id,requester,created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(20),
    db.from("audit_logs").select("id,actor_name,action,file_id,ts").in("action", ["trash", "perm-delete", "restore", "vault-view", "download", "share"]).order("ts", { ascending: false }).limit(30),
    db.from("audit_logs").select("action,ts").gte("ts", twoWeeks).order("ts", { ascending: false }).limit(1000),
    db.from("jobs").select("kind,status,created_at").order("created_at", { ascending: false }).limit(10),
    db.from("login_attempts").select("email,created_at").gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()).order("created_at", { ascending: false }).limit(200)
  ]);

  const people = (profiles ?? []) as { username: string; role: string }[];
  const confirmedIds = new Set(((totp ?? []) as { user_id: string; confirmed: boolean }[]).filter((t) => t.confirmed).map((t) => t.user_id));
  const { data: profIds } = await db.from("profiles").select("id,username");
  const idName = new Map(((profIds ?? []) as { id: string; username: string }[]).map((p) => [p.id, p.username]));
  const noMfa = ((profIds ?? []) as { id: string; username: string }[]).filter((p) => !confirmedIds.has(p.id)).map((p) => p.username);
  const locked = ((totp ?? []) as { user_id: string; locked_until: string | null }[]).filter((t) => t.locked_until && new Date(t.locked_until) > new Date());

  const fileIds = Array.from(new Set(((events ?? []) as { file_id: string | null }[]).map((e) => e.file_id).filter(Boolean))) as string[];
  const { data: fnames } = fileIds.length
    ? await db.from("file_index").select("id,name,size").in("id", fileIds)
    : { data: [] as { id: string; name: string; size: number }[] };
  const fname = new Map(((fnames ?? []) as { id: string; name: string; size: number }[]).map((f) => [f.id, f]));

  const failsByEmail = new Map<string, number>();
  for (const f of (failures ?? []) as { email: string }[]) failsByEmail.set(f.email, (failsByEmail.get(f.email) ?? 0) + 1);

  const tenMinAgo = Date.now() - 10 * 60000;
  const recentTrash = ((events ?? []) as { action: string; ts: string }[]).filter((e) => e.action === "trash" && new Date(e.ts).getTime() > tenMinAgo).length;

  const hb = ((jobs ?? []) as { kind: string; created_at: string }[]).find((j) => j.kind === "agent-heartbeat");
  const agentMin = hb ? Math.round((Date.now() - new Date(hb.created_at).getTime()) / 60000) : null;
  const lastBackup = ((jobs ?? []) as { kind: string; status: string; created_at: string }[]).find((j) => j.kind.startsWith("backup") || j.kind === "drive-sync");
  const quota = await getAboutQuota().catch(() => null);

  // 14 daily buckets: all audited events vs sensitive ones (deletes, downloads, shares, vault access)
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.now() - (13 - i) * 24 * 3600_000); return { key: key(d), label: d.toLocaleDateString("en-GB", { month: "short", day: "2-digit" }), all: 0, sensitive: 0 }; });
  const byDay = new Map(days.map((d) => [d.key, d]));
  for (const e of (recent ?? []) as { action: string; ts: string }[]) {
    const b = byDay.get(key(new Date(e.ts)));
    if (!b) continue;
    b.all++;
    if (actionMeta(e.action).sensitive) b.sensitive++;
  }

  const data: SecurityData = {
    massDelete: { active: recentTrash >= 20, count: recentTrash },
    events14: ((recent ?? []) as unknown[]).length,
    failedTotal: ((failures ?? []) as unknown[]).length,
    failed: [...failsByEmail.entries()].map(([email, n]) => ({ email, n })).sort((a, b) => b.n - a.n),
    approvals: ((pending ?? []) as { id: string; file_id: string; requester: string; created_at: string }[]).map((a) => ({
      id: a.id, file: fname.get(a.file_id)?.name ?? "file", requester: idName.get(a.requester) ?? "someone", created: a.created_at
    })),
    people: people.length,
    noMfa,
    locked: locked.length,
    agent: { minutes: agentMin, online: agentMin !== null && agentMin < 10 },
    days: days.map(({ label, all, sensitive }) => ({ label, all, sensitive })),
    feed: ((events ?? []) as { id: number; actor_name: string; action: string; file_id: string | null; ts: string }[]).map((e) => ({
      id: e.id, actor: e.actor_name, action: e.action, file: e.file_id ? fname.get(e.file_id)?.name ?? null : null, ts: e.ts
    })),
    backends: {
      googleUsed: quota?.usage ?? null, googleLimit: quota?.limit ?? null,
      googleAlert: quota && quota.limit > 0 ? (storageAlert(quota.usage, quota.limit) as "storage-80" | "storage-95" | null) : null,
      lastBackup: lastBackup ? { kind: lastBackup.kind, status: lastBackup.status, ts: lastBackup.created_at } : null
    },
    roles: { admins: people.filter((p) => p.role === "admin").length, managers: people.filter((p) => p.role === "manager").length, members: people.filter((p) => p.role === "member").length },
    fmtBytes: formatBytes
  };
  return <SecurityView {...data} />;
}
