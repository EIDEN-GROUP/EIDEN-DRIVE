"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, Pill, StorageBar } from "@/components/ui/primitives";
import { toast } from "@/components/ui/Toast";
import { formatBytes } from "@/lib/files";

interface Job { kind: string; status: string; created_at: string }
interface Drive {
  id: string; label: string; email: string | null; status: string; rootKind?: string; rootId?: string | null;
  used: number; total: number; alert?: string | null;
}

function fmtDate(d: string): string {
  const t = new Date(d);
  return isNaN(t.getTime()) ? "--" : t.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
  const totalUsed = (data?.drives ?? []).reduce((a, d) => a + d.used, 0);
  const totalCap = (data?.drives ?? []).reduce((a, d) => a + d.total, 0);

  return (
    <section className="px-1 pt-1">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="page-title">Storage & Backups</h1>
          {data && totalCap > 0 && (
            <p className="text-sm text-muted mt-1">{formatBytes(totalUsed)} of {formatBytes(totalCap)} across {data.drives.filter((d) => d.status === "active").length} drive{(data.drives.filter((d) => d.status === "active").length === 1) ? "" : "s"}</p>
          )}
        </div>
        <a href="/api/auth/google?label=drive" className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-md bg-brand text-white text-sm font-medium">
          <Plus size={15} /> Connect another drive
        </a>
      </div>
      <div className="grid md:grid-cols-2 gap-4 items-start">
        <Card label={`Google drives · ${(data?.drives ?? []).filter((d) => d.status === "active").length} connected`}>
          {!data ? <p className="text-sm text-muted" role="status">Reading storage…</p> : (
            <div className="mt-1 flex flex-col gap-4">
              {(data.drives ?? []).map((d) => (
                <div key={d.id}>
                  <p className="text-[13px] font-medium flex items-center gap-2 flex-wrap">
                    {d.label}
                    {d.email && <span className="font-normal text-muted">{d.email}</span>}
                    {d.status !== "active"
                      ? <Pill tone="red">{d.status === "down" ? "Unreachable — reconnect it" : d.status}</Pill>
                      : d.rootKind === "folder" ? <Pill tone="fill">folder root</Pill>
                      : d.rootKind === "drive" ? <Pill tone="green">shared drive</Pill> : null}
                    {data.canManage && d.id !== "legacy" && (
                      <span className="ml-auto inline-flex gap-1.5">
                        <button onClick={() => setStatus(d, d.status === "active" ? "disabled" : "active")}
                          aria-label={`${d.status === "active" ? "Disable" : "Enable"} ${d.label}`}
                          className="min-h-[36px] px-2.5 rounded-md border border-line text-[12px] hover:bg-tint">
                          {d.status === "active" ? "Disable" : "Enable"}
                        </button>
                        <button onClick={() => setConfirmDel(d)} aria-label={`Disconnect ${d.label}`}
                          className="min-h-[36px] px-2.5 rounded-md border border-danger/40 text-danger text-[12px]">
                          Delete
                        </button>
                      </span>
                    )}
                  </p>
                  {data.canManage && d.id !== "legacy" && (
                    <RootEditor drive={d} onSaved={load} onResync={() => resyncClean(d)} />
                  )}
                  {d.total > 0 ? (
                    <div className="mt-1.5">
                      <StorageBar label={`${formatBytes(d.used)} / ${formatBytes(d.total)}`} used={d.used} total={d.total} />
                      {d.alert && <p className="mt-1 text-xs text-danger" role="alert">Above {d.alert === "storage-95" ? "95" : "80"}% — new uploads route to other drives automatically.</p>}
                    </div>
                  ) : d.status === "active" ? (
                    <p className="text-xs text-muted mt-1">Quota not reported by Google (unlimited Workspace or hidden) — uploads allowed.</p>
                  ) : (
                    <p className="text-xs text-muted mt-1">Not connected yet.</p>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted flex items-center gap-2 pt-1 border-t border-line/60">
                Local agent
                <Pill tone={data.agent.online ? "green" : "red"}>{data.agent.online ? `Online · ${data.agent.heartbeat_min_ago}m ago` : "Offline"}</Pill>
              </p>
              <p className="text-xs text-muted">Uploads mirror to the roomiest drive automatically; full drives are skipped, never attempted.</p>
            </div>
          )}
        </Card>
        <Card label="Backups schedule">
          <p className="text-sm text-muted">Automatic: on every change (Drive webhook) + nightly agent snapshot. On demand:</p>
          <button onClick={checkNow} disabled={busy} className="mt-3 min-h-[44px] px-4 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50">
            {busy ? "Queuing…" : "Run backup check now"}
          </button>
          <ul className="mt-4 text-sm divide-y divide-line/70">
            {(data?.jobs ?? []).slice(0, 8).map((j, i) => (
              <li key={i} className="py-2 flex items-center justify-between gap-2">
                <span className="truncate">{j.kind.replace(/-/g, " ")}</span>
                <span className="text-xs text-muted shrink-0">{j.status} · {fmtDate(j.created_at)}</span>
              </li>
            ))}
            {data && backups.length === 0 && <li className="py-2 text-sm text-muted">No backup jobs yet — queue the first check above.</li>}
            {!data && <li className="py-2 text-sm text-muted" role="status">Reading jobs…</li>}
          </ul>
          {lastBackup && <p className="mt-2 text-xs text-muted">Last backup activity: {fmtDate(lastBackup.created_at)}</p>}
        </Card>
      </div>
      {confirmDel && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Disconnect ${confirmDel.label}`}>
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmDel(null)} />
          <div className="pop-in relative w-full max-w-sm rounded-xl bg-surface border border-line shadow-pop p-5">
            <p className="text-[15px] font-medium">Disconnect “{confirmDel.label}”?</p>
            <p className="mt-2 text-[13px] text-muted">FileOS forgets its token. Indexed files stay (readable); Google copies are untouched. Reconnect anytime from the button above.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="min-h-[44px] px-4 rounded-md border border-line text-sm">Cancel</button>
              <button onClick={delDrive} className="min-h-[44px] px-4 rounded-md bg-danger text-white text-sm font-medium">Disconnect</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
