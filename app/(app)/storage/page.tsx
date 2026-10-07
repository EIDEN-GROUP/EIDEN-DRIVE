"use client";
import { useEffect, useState } from "react";
import { HardDrive, Plus, ShieldCheck } from "lucide-react";
import { EmptyNote, IconBadge, Kpi, KpiRow, PageHead, Panel, StatusPill, relTime } from "@/components/dash/Dash";
import { toast } from "@/components/ui/Toast";
import { formatBytes } from "@/lib/files";

interface Job { kind: string; status: string; created_at: string }
interface Drive {
  id: string; label: string; email: string | null; status: string; rootKind?: string; rootId?: string | null;
  used: number; total: number; alert?: string | null;
}

// Per-drive scope editor: pin the account to one folder/drive ID (paste it from
// the Drive URL), or resync-clean after re-scoping. Whole-My-Drive requires the
// explicit checkbox — that scope is what floods indexes with system dirs.
function RootEditor({ drive, onSaved, onResync }: { drive: Drive; onSaved: () => void; onResync: () => void }) {
  const [rootId, setRootId] = useState(drive.rootId ?? "");
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = (rootId.trim() || "") !== (drive.rootId ?? "") || (full && !(drive.rootId ?? ""));

  async function save() {
    setBusy(true);
    const r = await fetch("/api/drive/accounts", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: drive.id, root_id: rootId.trim(), allowFullDrive: full })
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast({ text: j.error ?? "Couldn't save root.", tone: "err" }); return; }
    toast({ text: `“${drive.label}” re-scoped — resync-clean it, then Sync.`, tone: "ok" });
    onSaved();
  }

  return (
    <details className="mt-1.5 text-[12.5px]">
      <summary className="cursor-pointer text-muted hover:text-ink min-h-[32px] inline-flex items-center">Scope & cleanup</summary>
      <div className="mt-1.5 p-2.5 rounded-md border border-line bg-soft space-y-2">
        <label className="block">
          <span className="text-[11.5px] text-muted">Root folder / Shared Drive ID (from the Drive URL)</span>
          <input value={rootId} onChange={(e) => { setRootId(e.target.value); setFull(false); }} placeholder="1gDx… (empty = whole My Drive)"
            spellCheck={false} aria-label={`Root ID for ${drive.label}`}
            className="mt-1 w-full min-h-[40px] rounded-md border border-line bg-surface px-2 font-mono text-[12px]" />
        </label>
        {!rootId.trim() && (
          <label className="flex items-start gap-2 text-[12px] cursor-pointer">
            <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} className="mt-1 size-4 accent-brand" />
            <span>Yes, index the <strong>entire</strong> My Drive (includes everything, e.g. app/system folders)</span>
          </label>
        )}
        <div className="flex gap-2 flex-wrap">
          <button onClick={save} disabled={!dirty || busy || (!rootId.trim() && !full)}
            className="min-h-[40px] px-3 rounded-md bg-brand text-white text-[12.5px] font-medium disabled:opacity-50">
            {busy ? "Checking…" : "Save scope"}
          </button>
          <button onClick={onResync} title="Drop this drive's indexed rows so the next Sync rebuilds from truth"
            className="min-h-[40px] px-3 rounded-md border border-line text-[12.5px] hover:bg-tint">
            Resync clean
          </button>
        </div>
      </div>
    </details>
  );
}

export default function StoragePage() {
  const [data, setData] = useState<{ drives: Drive[]; canManage?: boolean; jobs: Job[]; agent: { heartbeat_min_ago: number | null; online: boolean } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Drive | null>(null);

  async function load() {
    const r = await fetch("/api/storage");
    if (r.ok) setData(await r.json());
  }
  useEffect(() => { load(); }, []);

  async function checkNow() {
    setBusy(true);
    const r = await fetch("/api/storage", { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { toast({ text: "Backup check queued — the agent picks it up.", tone: "ok" }); load(); }
    else toast({ text: d.error ?? "Couldn't queue check.", tone: "err" });
  }

  const backups = (data?.jobs ?? []).filter((j) => j.kind.startsWith("backup") || j.kind === "agent-heartbeat");
  const lastBackup = backups.find((j) => j.kind.startsWith("backup"));

  async function setStatus(d: Drive, status: "active" | "disabled") {
    const r = await fetch("/api/drive/accounts", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: d.id, status })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast({ text: j.error ?? "Couldn't update drive.", tone: "err" }); return; }
    toast({ text: `"${d.label}" ${status === "active" ? "enabled" : "disabled"}.`, tone: "ok" });
    load();
  }
  async function delDrive() {
    if (!confirmDel) return;
    const r = await fetch("/api/drive/accounts", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: confirmDel.id })
    });
    const j = await r.json().catch(() => ({}));
    setConfirmDel(null);
    if (!r.ok) { toast({ text: j.error ?? "Couldn't remove drive.", tone: "err" }); return; }
    toast({ text: "Drive disconnected — its files stay indexed.", tone: "ok" });
    load();
  }
  async function resyncClean(d: Drive) {
    const r = await fetch("/api/drive/resync-clean", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: d.id })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast({ text: j.error ?? "Couldn't clean index.", tone: "err" }); return; }
    toast({ text: `Index cleaned (${j.deleted} removed, ${j.unpinned} unpinned) — run Sync from Google next.`, tone: "ok" });
    load();
  }
  const active = (data?.drives ?? []).filter((d) => d.status === "active");
  const totalUsed = active.reduce((a, d) => a + d.used, 0);
  const totalCap = active.reduce((a, d) => a + d.total, 0);
  const pct = totalCap > 0 ? Math.round((totalUsed / totalCap) * 100) : null;
  const jobTone = (st: string): "good" | "warn" | "bad" | "neutral" => (st === "done" ? "good" : st === "pending" ? "warn" : st === "failed" || st === "error" ? "bad" : "neutral");

  return (
    <section className="px-1 pt-1 max-w-[1400px] mx-auto">
      <PageHead title="Storage & Backups" subtitle="Your connected Google drives, capacity, and backup checks."
        actions={<>
          {data?.canManage && <button onClick={checkNow} disabled={busy} className="min-h-[44px] px-4 rounded-lg border border-line bg-surface text-[14px] flex items-center gap-2 hover:bg-tint disabled:opacity-50 transition-colors"><ShieldCheck size={16} /> {busy ? "Queuing…" : "Run backup check"}</button>}
          <a href="/api/auth/google?label=drive" className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-lg bg-brand text-white text-[14px] font-medium hover:brightness-110 transition"><Plus size={16} /> Connect another drive</a>
        </>} />

      <KpiRow>
        <Kpi label="Used" value={data ? formatBytes(totalUsed) : "…"} hint={totalCap > 0 ? `of ${formatBytes(totalCap)}` : "quota not reported"} />
        <Kpi label="Capacity used" value={pct === null ? "—" : `${pct}%`} tone={pct !== null && pct >= 95 ? "bad" : pct !== null && pct >= 80 ? "warn" : "default"} hint={pct !== null && pct >= 80 ? "uploads route to other drives" : "all drives combined"} />
        <Kpi label="Drives connected" value={data ? active.length : "…"} hint={data && data.drives.length > active.length ? `${data.drives.length - active.length} not active` : "all active"} />
        <Kpi label="Local agent" value={!data ? "…" : data.agent.heartbeat_min_ago === null ? "Never" : data.agent.online ? "Online" : "Offline"} tone={data?.agent.online ? "good" : "warn"} hint={data?.agent.heartbeat_min_ago == null ? "no heartbeat yet" : `seen ${data.agent.heartbeat_min_ago}m ago`} />
        <Kpi label="Backup jobs" value={data ? backups.filter((j) => j.kind.startsWith("backup")).length : "…"} hint={lastBackup ? `last ${relTime(lastBackup.created_at)}` : "none yet"} />
        <Kpi label="Sync" value={data ? (data.jobs.find((j) => j.kind === "drive-sync") ? "Done" : "—") : "…"} tone="good" hint={(() => { const j = data?.jobs.find((x) => x.kind === "drive-sync"); return j ? relTime(j.created_at) : "not run yet"; })()} />
      </KpiRow>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_400px] gap-4 sm:gap-5 items-start">
        <Panel title="Google drives" subtitle={`${active.length} connected · uploads go to the drive with the most free space`}>
          {!data ? <div className="space-y-3" role="status" aria-label="Reading storage"><div className="skel h-24 w-full" /><div className="skel h-24 w-full" /></div> : data.drives.length === 0 ? (
            <EmptyNote>No drive connected yet. Use “Connect another drive” above.</EmptyNote>
          ) : (
            <ul className="space-y-3">
              {data.drives.map((d) => {
                const p = d.total > 0 ? Math.min(100, Math.round((d.used / d.total) * 100)) : null;
                return (
                  <li key={d.id} className={`rounded-xl border border-line p-4 ${d.status !== "active" ? "opacity-80" : ""}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <IconBadge Icon={HardDrive} color="#533faf" />
                      <div className="min-w-0 flex-1 basis-44">
                        <p className="text-[16px] font-medium truncate">{d.label}</p>
                        <p className="text-[12.5px] text-muted truncate">{d.email ?? "—"}</p>
                      </div>
                      {d.status !== "active" ? <StatusPill tone="bad">{d.status === "down" ? "Unreachable — reconnect it" : d.status}</StatusPill>
                        : d.rootKind === "folder" ? <StatusPill tone="brand">Folder root</StatusPill>
                        : d.rootKind === "drive" ? <StatusPill tone="good">Shared drive</StatusPill> : <StatusPill tone="neutral">My Drive</StatusPill>}
                      {data.canManage && d.id !== "legacy" && (
                        <span className="inline-flex gap-2">
                          <button onClick={() => setStatus(d, d.status === "active" ? "disabled" : "active")} aria-label={`${d.status === "active" ? "Disable" : "Enable"} ${d.label}`}
                            className="min-h-[40px] px-3.5 rounded-lg border border-line text-[13px] hover:bg-tint transition-colors">{d.status === "active" ? "Disable" : "Enable"}</button>
                          <button onClick={() => setConfirmDel(d)} aria-label={`Disconnect ${d.label}`}
                            className="min-h-[40px] px-3.5 rounded-lg border border-danger/40 text-danger text-[13px] hover:bg-danger/5 transition-colors">Disconnect</button>
                        </span>
                      )}
                    </div>
                    {p !== null ? (
                      <div className="mt-4">
                        <div className="flex justify-between text-[12.5px] text-muted mb-1.5"><span className="tabular-nums">{formatBytes(d.used)} of {formatBytes(d.total)}</span><span className="tabular-nums">{p}%</span></div>
                        <div className="h-2 rounded-full bg-tint overflow-hidden" role="img" aria-label={`${p}% used`}><div className={`h-full rounded-full ${p >= 95 ? "bg-danger" : p >= 80 ? "bg-warning" : "bg-brand"}`} style={{ width: `${p}%` }} /></div>
                        {d.alert && <p className="mt-2 text-[12.5px] text-danger" role="alert">Above {d.alert === "storage-95" ? "95" : "80"}% — new uploads route to other drives automatically.</p>}
                      </div>
                    ) : d.status === "active" ? <p className="mt-3 text-[12.5px] text-muted">Quota not reported by Google (unlimited Workspace or hidden) — uploads allowed.</p>
                      : <p className="mt-3 text-[12.5px] text-muted">Not connected right now.</p>}
                    {data.canManage && d.id !== "legacy" && <RootEditor drive={d} onSaved={load} onResync={() => resyncClean(d)} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Backups" subtitle="The local agent verifies backups when it runs">
          <p className="text-[13.5px] text-muted -mt-1 mb-4">Queue a check and the agent picks it up on its next heartbeat{data && !data.agent.online ? " — it is offline right now, so the job will wait" : ""}.</p>
          {(data?.jobs ?? []).length === 0 && data ? <EmptyNote>No jobs yet — queue the first check.</EmptyNote> : (
            <ul className="divide-y divide-line/60 -my-1">
              {(data?.jobs ?? []).slice(0, 8).map((j, i) => (
                <li key={i} className="py-3 flex items-center gap-3">
                  <span className="min-w-0 flex-1"><span className="block text-[14px] capitalize truncate">{j.kind.replace(/-/g, " ")}</span><span className="block text-[12px] text-muted">{relTime(j.created_at)}</span></span>
                  <StatusPill tone={jobTone(j.status)}>{j.status}</StatusPill>
                </li>
              ))}
              {!data && <li className="py-3 text-[13px] text-muted" role="status">Reading jobs…</li>}
            </ul>
          )}
        </Panel>
      </div>

      {confirmDel && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Disconnect ${confirmDel.label}`}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setConfirmDel(null)} />
          <div className="pop-in relative w-full max-w-sm rounded-2xl bg-surface border border-line shadow-pop p-6">
            <p className="text-[17px] font-medium">Disconnect “{confirmDel.label}”?</p>
            <p className="mt-2 text-[13.5px] text-muted">Eiden Drive forgets its token. Indexed files stay (readable); Google copies are untouched. Reconnect anytime from “Connect another drive”.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="min-h-[44px] px-4 rounded-lg border border-line text-sm hover:bg-tint">Cancel</button>
              <button onClick={delDrive} className="min-h-[44px] px-4 rounded-lg bg-danger text-white text-sm font-medium">Disconnect</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
