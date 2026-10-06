import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { getAboutQuota } from "@/lib/google-drive";
import { storageAlert } from "@/lib/alerts";
import { formatBytes } from "@/lib/files";
import { Card, Pill } from "@/components/ui/primitives";
import ApprovalsList from "@/components/drive/ApprovalsList";

export const dynamic = "force-dynamic";

function fmt(ts: string): string {
  const t = new Date(ts);
  return isNaN(t.getTime()) ? "--" : t.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

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
  const [
    { data: profiles },
    { data: totp },
    { data: pending },
    { data: events },
    { data: jobs },
    { data: failures }
  ] = await Promise.all([
    db.from("profiles").select("username,role").limit(500),
    db.from("vault_totp").select("user_id,confirmed,locked_until,fail_count"),
    db.from("approvals").select("id,file_id,requester,created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(20),
    db.from("audit_logs").select("id,actor_name,action,file_id,created_at,ts").in("action", ["trash", "perm-delete", "restore", "vault-view", "download", "share"]).order("created_at", { ascending: false }).limit(30),
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
  const recentTrash = ((events ?? []) as { action: string; created_at: string }[]).filter((e) => e.action === "trash" && new Date(e.created_at).getTime() > tenMinAgo).length;
  const massDelete = recentTrash >= 20;

  const hb = ((jobs ?? []) as { kind: string; created_at: string }[]).find((j) => j.kind === "agent-heartbeat");
  const agentMin = hb ? Math.round((Date.now() - new Date(hb.created_at).getTime()) / 60000) : null;
  const lastBackup = ((jobs ?? []) as { kind: string; status: string; created_at: string }[]).find((j) => j.kind.startsWith("backup") || j.kind === "drive-sync");
  const quota = await getAboutQuota().catch(() => null);

  const approvals = ((pending ?? []) as { id: string; file_id: string; requester: string; created_at: string }[]).map((a) => ({
    id: a.id,
    file: fname.get(a.file_id)?.name ?? "file",
    requester: idName.get(a.requester) ?? "someone",
    created: a.created_at
  }));

  return (
    <section className="px-1 pt-1">
      <h1 className="page-title mb-4">Security Center</h1>
      {massDelete && (
        <div className="mb-4 p-4 rounded-xl border border-danger/40 bg-danger/5 text-sm" role="alert">
          <strong className="text-danger">Mass delete in progress:</strong> {recentTrash} files trashed in the last 10 minutes. Review the events below.
        </div>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        <Card label="Backends">
          <ul className="text-sm mt-1 flex flex-col gap-2">
            <li className="flex items-center justify-between gap-2">Google Drive
              {quota ? <Pill tone="green">Connected · {formatBytes(quota.usage)} / {formatBytes(quota.limit)}</Pill>
                : <span className="text-xs text-muted">Not connected — <a className="underline text-brand" href="/api/auth/google">connect</a></span>}
            </li>
            <li className="flex items-center justify-between gap-2">Local agent
              <Pill tone={agentMin !== null && agentMin < 10 ? "green" : "red"}>
                {agentMin === null ? "Never seen" : agentMin < 10 ? `Online · ${agentMin}m ago` : `Offline · ${agentMin}m ago`}
              </Pill>
            </li>
            <li className="flex items-center justify-between gap-2">Last backup activity
              <span className="text-xs text-muted">{lastBackup ? `${lastBackup.kind} · ${lastBackup.status} · ${fmt(lastBackup.created_at)}` : "None yet"}</span>
            </li>
          </ul>
          {quota && quota.limit > 0 && storageAlert(quota.usage, quota.limit) && (
            <p className="mt-2 text-xs text-danger" role="alert">Google storage above {storageAlert(quota.usage, quota.limit) === "storage-95" ? "95" : "80"}% — free space or grow the plan.</p>
          )}
        </Card>

        <Card label={`Two-factor coverage · ${people.length - noMfa.length}/${people.length}`}>
          {noMfa.length === 0
            ? <p className="text-sm mt-1">Everyone enrolled. Vault unlocks stay gated behind TOTP with lockout.</p>
            : <ul className="text-sm mt-1">
              {noMfa.slice(0, 20).map((u) => <li key={u} className="py-1 border-b border-line/60 last:border-0">{u} <span className="text-muted">· no vault 2FA</span></li>)}
              {noMfa.length > 20 && <li className="text-xs text-muted">+{noMfa.length - 20} more</li>}
            </ul>}
          {locked.length > 0 && (
            <p className="mt-2 text-xs text-danger" role="alert">{locked.length} vault {locked.length === 1 ? "account is" : "accounts are"} temporarily locked after wrong codes.</p>
          )}
        </Card>

        <Card label={`Delete approvals · ${approvals.length} pending`}>
          <ApprovalsList items={approvals} />
        </Card>

        <Card label={`Failed sign-ins · 24 h (${failsByEmail.size} addresses)`}>
          {failsByEmail.size === 0
            ? <p className="text-sm mt-1 text-muted">None recorded.</p>
            : <ul className="text-sm mt-1">
              {[...failsByEmail.entries()].slice(0, 15).map(([email, n]) => (
                <li key={email} className="py-1 border-b border-line/60 last:border-0 flex justify-between gap-2">
                  <span className="truncate">{email}</span><span className="text-muted tabular-nums">×{n}</span>
                </li>
              ))}
            </ul>}
        </Card>

        <Card label="Events">
          {((events ?? []) as { id: string; actor_name: string; action: string; file_id: string | null; created_at: string }[]).length === 0
            ? <p className="text-sm mt-1 text-muted">No security-relevant events yet.</p>
            : <ul className="text-sm mt-1">
              {((events ?? []) as { id: string; actor_name: string; action: string; file_id: string | null; created_at: string }[]).map((e) => (
                <li key={e.id} className="py-1 border-b border-line/60 last:border-0">
                  {e.actor_name} · {e.action} · {e.file_id && fname.get(e.file_id) ? fname.get(e.file_id)!.name : "—"} · <span className="text-muted">{fmt(e.created_at)}</span>
                </li>
              ))}
            </ul>}
        </Card>

        <Card label="Accounts">
          <ul className="text-sm mt-1">
            <li className="py-1">Admins · {people.filter((p) => p.role === "admin").length}</li>
            <li className="py-1">Managers · {people.filter((p) => p.role === "manager").length}</li>
            <li className="py-1">Members · {people.filter((p) => p.role === "member").length}</li>
          </ul>
          <p className="mt-2 text-xs text-muted">Manage people on the <a className="underline text-brand" href="/users">Users</a> page.</p>
        </Card>
      </div>
    </section>
  );
}
