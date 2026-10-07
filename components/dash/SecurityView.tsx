import Link from "next/link";
import { Activity, AlertTriangle, ShieldCheck, Users } from "lucide-react";
import { EmptyNote, FeedItem, Kpi, KpiRow, LineChart, PageHead, Panel, StatusPill, relTime } from "./Dash";
import { actionMeta } from "./actions";
import ApprovalsList, { type Approval } from "../drive/ApprovalsList";

export interface SecurityData {
  massDelete: { active: boolean; count: number };
  events14: number;
  failedTotal: number;
  failed: { email: string; n: number }[];
  approvals: Approval[];
  people: number;
  noMfa: string[];
  locked: number;
  agent: { minutes: number | null; online: boolean };
  days: { label: string; all: number; sensitive: number }[];
  feed: { id: number; actor: string; action: string; file: string | null; ts: string }[];
  backends: { googleUsed: number | null; googleLimit: number | null; googleAlert: "storage-80" | "storage-95" | null; lastBackup: { kind: string; status: string; ts: string } | null };
  roles: { admins: number; managers: number; members: number };
  fmtBytes: (n: number) => string;
}

// Security Center view. All numbers arrive pre-computed from live queries (see page.tsx) — nothing here is sample data.
export default function SecurityView(d: SecurityData) {
  const mfaPct = d.people ? Math.round(((d.people - d.noMfa.length) / d.people) * 100) : 100;
  const attention = d.massDelete.active || d.failedTotal > 0 || d.approvals.length > 0 || d.locked > 0 || mfaPct < 100 || !d.agent.online;
  const bar = (pct: number, tone: string) => (
    <div className="h-2 rounded-full bg-tint overflow-hidden" role="img" aria-label={`${pct}%`}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} /></div>
  );
  const link = "min-h-[44px] px-4 rounded-lg border border-line bg-surface text-[14px] inline-flex items-center gap-2 hover:bg-tint transition-colors";

  return (
    <section className="px-1 pt-1 max-w-[1400px] mx-auto">
      <PageHead title="Security Center"
        subtitle={<span className="inline-flex items-center gap-2 flex-wrap">Live posture, activity volume, and what needs a human. <StatusPill tone={attention ? "warn" : "good"}>{attention ? "Needs attention" : "All clear"}</StatusPill></span>}
        actions={<><Link href="/activity" className={link}><Activity size={16} /> Activity log</Link><Link href="/users" className={link}><Users size={16} /> Manage people</Link></>} />

      {d.massDelete.active && (
        <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/5 p-4 text-[14px]">
          <AlertTriangle size={20} className="text-danger shrink-0 mt-0.5" />
          <p><strong className="text-danger font-medium">Mass delete in progress:</strong> {d.massDelete.count} files trashed in the last 10 minutes. Review the security events below.</p>
        </div>
      )}

      <KpiRow>
        <Kpi label="Events · 14 days" value={d.events14.toLocaleString()} hint="all audited actions" />
        <Kpi label="Failed sign-ins · 24 h" value={d.failedTotal} tone={d.failedTotal > 0 ? "bad" : "default"} hint={d.failedTotal ? `${d.failed.length} address${d.failed.length === 1 ? "" : "es"}` : "none recorded"} />
        <Kpi label="Approvals pending" value={d.approvals.length} tone={d.approvals.length > 0 ? "warn" : "default"} hint="delete requests" />
        <Kpi label="Vault 2FA coverage" value={`${mfaPct}%`} tone={mfaPct < 100 ? "warn" : "good"} hint={`${d.people - d.noMfa.length} of ${d.people} people`} />
        <Kpi label="Locked accounts" value={d.locked} tone={d.locked > 0 ? "bad" : "default"} hint="after wrong codes" />
        <Kpi label="Local agent" value={d.agent.minutes === null ? "Never" : d.agent.online ? "Online" : "Offline"} tone={d.agent.online ? "good" : "warn"} hint={d.agent.minutes === null ? "no heartbeat yet" : `seen ${d.agent.minutes}m ago`} />
      </KpiRow>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_400px] gap-4 sm:gap-5 mb-5">
        <Panel title="Audit activity" subtitle="Events per day · last 14 days">
          <LineChart labels={d.days.map((x) => x.label)} yLabel="Events" empty="No audited events in this window yet."
            series={[{ name: "All events", color: "#533faf", values: d.days.map((x) => x.all) }, { name: "Sensitive actions", color: "#e5322d", values: d.days.map((x) => x.sensitive) }]} />
        </Panel>
        <Panel title="Security events" subtitle="Deletes, downloads, shares and vault access">
          {d.feed.length === 0 ? <EmptyNote>No security-relevant events yet.</EmptyNote> : (
            <ul className="divide-y divide-line/60 -my-1">
              {d.feed.slice(0, 6).map((e) => { const m = actionMeta(e.action); return (
                <FeedItem key={e.id} Icon={m.Icon} color={m.color} time={relTime(e.ts)}>
                  <strong className="font-medium">{e.actor}</strong> {m.verb}{e.file ? <> <span className="text-brand">{e.file}</span></> : null}
                </FeedItem>); })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_400px] gap-4 sm:gap-5 mb-5">
        <Panel title="Delete approvals" subtitle="Files moved to the Recovery Bin that need a second decision"
          actions={d.approvals.length ? <StatusPill tone="warn">{d.approvals.length} pending</StatusPill> : undefined}>
          <ApprovalsList items={d.approvals} />
        </Panel>
        <Panel title="Two-factor coverage" subtitle="Who can open the Vault">
          <div className="flex items-end justify-between mb-2"><span className="text-[34px] leading-none font-medium tabular-nums">{mfaPct}%</span><span className="text-[12.5px] text-muted">{d.people - d.noMfa.length}/{d.people} enrolled</span></div>
          {bar(mfaPct, mfaPct < 100 ? "#f59e0b" : "#22c32e")}
          {d.noMfa.length === 0 ? <p className="mt-4 text-[13.5px] text-muted flex items-center gap-2"><ShieldCheck size={16} className="text-[#15902a]" /> Everyone is enrolled. Vault unlocks need a TOTP code, with lockout.</p> : (
            <ul className="mt-4 divide-y divide-line/60 text-[14px]">
              {d.noMfa.slice(0, 6).map((u) => <li key={u} className="py-2 flex items-center justify-between gap-2"><span className="truncate">{u}</span><StatusPill tone="warn">no 2FA</StatusPill></li>)}
              {d.noMfa.length > 6 && <li className="py-2 text-[12.5px] text-muted">+{d.noMfa.length - 6} more</li>}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
        <Panel title="Failed sign-ins" subtitle="Last 24 hours, by address">
          {d.failed.length === 0 ? <EmptyNote>None recorded.</EmptyNote> : (
            <ul className="divide-y divide-line/60 text-[14px] -my-1">
              {d.failed.slice(0, 8).map((f) => <li key={f.email} className="py-2.5 flex items-center justify-between gap-3"><span className="truncate">{f.email}</span><StatusPill tone="bad">×{f.n}</StatusPill></li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Backends" subtitle="Where your files live">
          <ul className="text-[14px] divide-y divide-line/60 -my-1">
            <li className="py-3 flex items-center justify-between gap-3">Google Drive
              {d.backends.googleLimit ? <StatusPill tone={d.backends.googleAlert ? "warn" : "good"}>{d.fmtBytes(d.backends.googleUsed ?? 0)} / {d.fmtBytes(d.backends.googleLimit)}</StatusPill>
                : <Link href="/storage" className="text-brand text-[13px] hover:underline">Connect a drive</Link>}</li>
            <li className="py-3 flex items-center justify-between gap-3">Local agent <StatusPill tone={d.agent.online ? "good" : "warn"}>{d.agent.minutes === null ? "Never seen" : d.agent.online ? `Online · ${d.agent.minutes}m ago` : `Offline · ${d.agent.minutes}m ago`}</StatusPill></li>
            <li className="py-3 flex items-center justify-between gap-3">Last backup activity <span className="text-[12.5px] text-muted text-right">{d.backends.lastBackup ? `${d.backends.lastBackup.kind} · ${d.backends.lastBackup.status} · ${relTime(d.backends.lastBackup.ts)}` : "none yet"}</span></li>
          </ul>
          {d.backends.googleAlert && <p className="mt-3 text-[12.5px] text-danger" role="alert">Google storage above {d.backends.googleAlert === "storage-95" ? "95" : "80"}% — free space or grow the plan.</p>}
        </Panel>
        <Panel title="Accounts" subtitle="Who has access">
          <ul className="text-[14px] divide-y divide-line/60 -my-1">
            {([["Admins", d.roles.admins], ["Managers", d.roles.managers], ["Members", d.roles.members]] as const).map(([l, n]) => (
              <li key={l} className="py-3 flex items-center justify-between"><span>{l}</span><span className="tabular-nums text-ink/80">{n}</span></li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] text-muted">Invite, edit or remove people on the <Link href="/users" className="text-brand hover:underline">Users</Link> page.</p>
        </Panel>
      </div>
    </section>
  );
}
