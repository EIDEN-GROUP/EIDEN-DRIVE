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

const ACTION_COLORS: Record<string, string> = {
  trash: "#f59e0b", "perm-delete": "#e5322d", restore: "#22c32e", download: "#7c3aed",
  share: "#0ea5a4", "vault-view": "#e5322d", add: "#22c32e", edit: "#22c32e", view: "#94a3b8"
};

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

  // ── graphs: 14-day volume bars + action mix donut, bucketed server-side data ──
  const days: { key: string; label: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600_000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ key, label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), count: 0 });
  }
  const byDay = new Map(days.map((d) => [d.key, d]));
  const mix = new Map<string, number>();
  for (const e of (recent ?? []) as { action: string; ts: string }[]) {
    const t = new Date(e.ts);
    const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const bucket = byDay.get(key);
    if (bucket) bucket.count++;
    mix.set(e.action, (mix.get(e.action) ?? 0) + 1);
  }
  const maxBar = Math.max(1, ...days.map((d) => d.count));
  const mixTotal = [...mix.values()].reduce((a, b) => a + b, 0);
  const mixRows = [...mix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  // SVG donut: segments as stroke-dasharray slices of a circle (r=15.9155 → C=100).
  let acc = 25;
  const donut = mixRows.map(([a, n]) => {
    const frac = mixTotal ? (n / mixTotal) * 100 : 0;
    const seg = { action: a, count: n, dash: `${Math.max(frac - 1.5, 0.5)} 100`, offset: 25 - acc, color: ACTION_COLORS[a] ?? "#94a3b8" };
    acc += frac;
    return seg;
  });

  const mfaPct = people.length ? Math.round(((people.length - noMfa.length) / people.length) * 100) : 100;
  const stats = [
    { label: "Events · 14 days", value: String(mixTotal), tone: "text-ink" },
    { label: "Failed sign-ins · 24 h", value: String((failures ?? []).length), tone: (failures ?? []).length > 0 ? "text-danger" : "text-ink" },
    { label: "Approvals pending", value: String(approvals.length), tone: approvals.length > 0 ? "text-amber-600" : "text-ink" },
    { label: "Vault 2FA coverage", value: `${mfaPct}%`, tone: mfaPct < 100 ? "text-amber-600" : "text-ink" }
  ];

  return (
    <section className="px-1 pt-1">
      <h1 className="page-title mb-1">Security Center</h1>
      <p className="text-[13px] text-muted mb-4">Live posture, activity volume, and what needs a human.</p>
      {massDelete && (
        <div className="mb-4 p-4 rounded-xl border border-danger/40 bg-danger/5 text-sm" role="alert">
          <strong className="text-danger">Mass delete in progress:</strong> {recentTrash} files trashed in the last 10 minutes. Review the events below.
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <p className={`text-[26px] font-semibold tabular-nums ${s.tone}`}>{s.value}</p>
            <p className="text-[12px] text-muted mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4 items-start mb-4">
        <Card label="Audit volume · last 14 days">
          {mixTotal === 0 ? (
            <p className="text-sm mt-1 text-muted">No audited events in this window yet.</p>
          ) : (
            <div className="mt-2 flex items-end gap-1 h-28" role="img" aria-label={`Audit events per day, total ${mixTotal}`}>
              {days.map((d) => (
                <div key={d.key} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${d.label}: ${d.count}`}>
                  <span className="text-[10px] tabular-nums text-muted">{d.count > 0 ? d.count : ""}</span>
                  <div className="w-full rounded-t bg-brand/80" style={{ height: `${Math.max(d.count > 0 ? 6 : 2, (d.count / maxBar) * 88)}px`, opacity: d.count ? 1 : 0.25 }} />
                  <span className="text-[9px] text-muted truncate w-full text-center">{d.label.split(" ")[0]}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card label="Action mix · 14 days">
          {mixTotal === 0 ? (
            <p className="text-sm mt-1 text-muted">Nothing to mix yet.</p>
          ) : (
            <div className="mt-1 flex items-center gap-4">
              <svg viewBox="0 0 42 42" className="size-28 shrink-0" role="img" aria-label="Action mix donut">
                <circle cx="21" cy="21" r="15.9155" fill="none" strokeWidth="7" stroke="var(--line)" />
                {donut.map((s) => (
                  <circle key={s.action} cx="21" cy="21" r="15.9155" fill="none" stroke={s.color}
                    strokeWidth="7" strokeDasharray={s.dash} strokeDashoffset={s.offset} />
                ))}
                <text x="21" y="24" textAnchor="middle" fill="var(--ink)" fontSize="8" fontWeight="600">{mixTotal}</text>
              </svg>
              <ul className="text-[13px] flex-1 min-w-0">
                {donut.map((s) => (
                  <li key={s.action} className="py-1 border-b border-line/60 last:border-0 flex items-center gap-2">
                    <span className="size-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                    <span className="truncate flex-1">{s.action}</span>
                    <span className="text-muted tabular-nums">{s.count} · {Math.round((s.count / mixTotal) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

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
          <div className="mt-2 h-2 rounded-full bg-tint overflow-hidden" role="img" aria-label={`${mfaPct}% enrolled`}>
            <div className="h-full bg-brand rounded-full" style={{ width: `${mfaPct}%` }} />
          </div>
          {noMfa.length === 0
            ? <p className="text-sm mt-2">Everyone enrolled. Vault unlocks stay gated behind TOTP with lockout.</p>
            : <ul className="text-sm mt-2">
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
          {((events ?? []) as { id: string; actor_name: string; action: string; file_id: string | null; ts: string }[]).length === 0
            ? <p className="text-sm mt-1 text-muted">No security-relevant events yet.</p>
            : <ul className="text-sm mt-1">
              {((events ?? []) as { id: string; actor_name: string; action: string; file_id: string | null; ts: string }[]).map((e) => (
                <li key={e.id} className="py-1 border-b border-line/60 last:border-0">
                  {e.actor_name} · {e.action} · {e.file_id && fname.get(e.file_id) ? fname.get(e.file_id)!.name : "—"} · <span className="text-muted">{fmt(e.ts)}</span>
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
