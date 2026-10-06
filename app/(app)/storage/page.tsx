"use client";
import { useEffect, useState } from "react";
import { Card, Pill, StorageBar } from "@/components/ui/primitives";
import { toast } from "@/components/ui/Toast";
import { formatBytes } from "@/lib/files";

interface Job { kind: string; status: string; created_at: string }

function fmtDate(d: string): string {
  const t = new Date(d);
  return isNaN(t.getTime()) ? "--" : t.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function StoragePage() {
  const [data, setData] = useState<{ google: { used: number; total: number; unconfigured?: boolean; alert: string | null }; jobs: Job[]; agent: { heartbeat_min_ago: number | null; online: boolean } } | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <section className="px-1 pt-1">
      <h1 className="page-title mb-4">Storage & Backups</h1>
      <div className="grid md:grid-cols-2 gap-4 items-start">
        <Card label="Capacity">
          {!data ? <p className="text-sm text-muted" role="status">Reading storage…</p> : (
            <div className="mt-1 flex flex-col gap-3">
              {data.google.total > 0 ? (
                <StorageBar label={`Google Drive ${formatBytes(data.google.used)} / ${formatBytes(data.google.total)}`} used={data.google.used} total={data.google.total} />
              ) : (
                <p className="text-sm text-muted">Google quota appears after the refresh-token flow (docs/10).</p>
              )}
              <p className="text-xs text-muted flex items-center gap-2">
                Local agent
                <Pill tone={data.agent.online ? "green" : "red"}>{data.agent.online ? `Online · ${data.agent.heartbeat_min_ago}m ago` : "Offline"}</Pill>
              </p>
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
    </section>
  );
}
