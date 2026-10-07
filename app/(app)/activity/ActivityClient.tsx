"use client";
import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search, X } from "lucide-react";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { EmptyNote, FeedItem, Kpi, KpiRow, LineChart, PageHead, Panel, StatusPill, relTime } from "@/components/dash/Dash";
import { ACTIONS, actionMeta } from "@/components/dash/actions";
import Pagination, { usePagination } from "@/components/ui/Pagination";

interface Entry { id: number; actor_name: string; action: string; file_id: string | null; detail: Record<string, unknown> | null; ip: string | null; ts: string }
const LIMIT = 300;

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function detailText(e: Entry): string | null {
  const d = e.detail ?? {};
  if (typeof d.name === "string") return d.name;
  if (typeof d.tag === "string") return `tag “${d.tag}”`;
  if (typeof d.label === "string") return d.label;
  if (typeof d.sync === "string") return `Google sync`;
  if (typeof d.copy_of === "string") return "a copy";
  if (typeof d.decision === "string") return `a delete request (${d.decision})`;
  if (typeof d.users === "string") return "a user account";
  if (typeof d.invite === "string") return `an invite for ${d.invite}`;
  if (typeof d.folder === "string") return `folder “${d.folder}”`;
  if (typeof d.q === "string" && d.q) return `search “${d.q}”`;
  return null;
}
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// Activity: what happened, by whom, when — KPI tiles, a 14-day trend, the latest events, and the full filterable log.
export default function ActivityClient() {
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(""); const [action, setAction] = useState(""); const [actor, setActor] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ q: "", action: "", actor: "", from: "", to: "" });

  async function run(f = applied) {
    setLoading(true);
    const sp = new URLSearchParams({ limit: String(LIMIT) });
    if (f.q) sp.set("q", f.q); if (f.action) sp.set("action", f.action); if (f.actor) sp.set("actor", f.actor);
    if (f.from) sp.set("from", f.from); if (f.to) sp.set("to", f.to);
    const r = await fetch(`/api/activity?${sp}`);
    const d = await r.json().catch(() => ({}));
    setItems(d.results ?? []); setLoading(false);
  }
  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => { const f = { q: q.trim(), action, actor: actor.trim(), from, to }; setApplied(f); run(f); };
  const clear = () => { setQ(""); setAction(""); setActor(""); setFrom(""); setTo(""); const f = { q: "", action: "", actor: "", from: "", to: "" }; setApplied(f); run(f); };
  const activeCount = Object.values(applied).filter(Boolean).length;

  const stats = useMemo(() => {
    const c = (a: string) => items.filter((e) => e.action === a).length;
    return { events: items.length, people: new Set(items.map((e) => e.actor_name)).size, added: c("add"), downloads: c("download"), binned: c("trash") + c("perm-delete"), views: c("view") };
  }, [items]);

  const chart = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return d; });
    const idx = new Map(days.map((d, i) => [dayKey(d), i]));
    const all = new Array(14).fill(0), changes = new Array(14).fill(0);
    for (const e of items) { const i = idx.get(dayKey(new Date(e.ts))); if (i === undefined) continue; all[i]++; if (actionMeta(e.action).change) changes[i]++; }
    return { labels: days.map((d) => d.toLocaleDateString("en-GB", { month: "short", day: "2-digit" })), all, changes };
  }, [items]);

  function exportCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [["time", "person", "action", "item", "ip"], ...items.map((e) => [new Date(e.ts).toISOString(), e.actor_name, e.action, detailText(e) ?? "", e.ip ?? ""])];
    const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `eiden-activity-${dayKey(new Date())}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast({ text: `Exported ${items.length} events.`, tone: "ok" });
  }

  const pager = usePagination(items, { defaultSize: 25, storageKey: "activity", resetKey: items });
  const input = "min-h-[44px] rounded-lg border border-line bg-surface px-3 text-[13.5px] focus:border-brand focus:outline-none";
  const feed = items.slice(0, 6);

  return (
    <section className="px-1 pt-1 max-w-[1400px] mx-auto">
      <PageHead title="Activity" subtitle="Every audited action — who did what, and when."
        actions={<>
          <button onClick={() => run()} className="min-h-[44px] px-4 rounded-lg border border-line bg-surface text-[14px] flex items-center gap-2 hover:bg-tint transition-colors"><RefreshCw size={16} /> Refresh</button>
          <button onClick={exportCsv} disabled={!items.length} className="min-h-[44px] px-4 rounded-lg border border-line bg-surface text-[14px] flex items-center gap-2 hover:bg-tint transition-colors disabled:opacity-50"><Download size={16} /> Export CSV</button>
        </>} />

      <KpiRow>
        <Kpi label="Events" value={loading ? "…" : stats.events.toLocaleString()} hint={`latest ${LIMIT} matching`} />
        <Kpi label="People" value={loading ? "…" : stats.people} hint="active in this list" />
        <Kpi label="Added" value={loading ? "…" : stats.added} tone="good" hint="files & folders" />
        <Kpi label="Downloads" value={loading ? "…" : stats.downloads} />
        <Kpi label="Moved to bin" value={loading ? "…" : stats.binned} tone={stats.binned > 0 ? "warn" : "default"} />
        <Kpi label="Views" value={loading ? "…" : stats.views} />
      </KpiRow>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_400px] gap-4 sm:gap-5 mb-5">
        <Panel title="Activity over time" subtitle="Events per day · last 14 days (from the events loaded below)">
          {loading ? <div className="skel h-64 w-full" aria-label="Loading chart" /> :
            <LineChart labels={chart.labels} yLabel="Events"
              series={[{ name: "All events", color: "#533faf", values: chart.all }, { name: "Changes", color: "#22c32e", values: chart.changes }]} />}
        </Panel>
        <Panel title="Latest activity" subtitle="Recent changes and updates">
          {loading ? <div className="space-y-3"><div className="skel h-12 w-full" /><div className="skel h-12 w-full" /><div className="skel h-12 w-full" /></div>
            : feed.length === 0 ? <EmptyNote>No events yet.</EmptyNote>
            : <ul className="divide-y divide-line/60 -my-1">
              {feed.map((e) => { const m = actionMeta(e.action); const d = detailText(e); return (
                <FeedItem key={e.id} Icon={m.Icon} color={m.color} time={relTime(e.ts)}>
                  <strong className="font-medium">{e.actor_name}</strong> {m.verb}{d ? <> <span className="text-brand">{d}</span></> : null}
                </FeedItem>); })}
            </ul>}
        </Panel>
      </div>

      <Panel title="Activity log" subtitle="Search and filter the full audit trail"
        actions={<span className="text-[13px] text-muted tabular-nums whitespace-nowrap pt-1">{items.length.toLocaleString()} event{items.length === 1 ? "" : "s"}</span>}>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_.9fr_.9fr_auto] mb-5">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} placeholder="Search person, action, IP…" aria-label="Search activity" className={`${input} w-full pl-10`} />
          </div>
          <Select label="Filter by action" value={action} onChange={setAction} placeholder="All actions"
            options={[{ value: "", label: "All actions" }, ...Object.entries(ACTIONS).map(([k, m]) => ({ value: k, label: m.label }))]} />
          <input value={actor} onChange={(e) => setActor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} placeholder="Person" aria-label="Filter by person" className={input} />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className={input} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className={input} />
          <div className="flex gap-2">
            <button onClick={apply} className="min-h-[44px] px-5 rounded-lg bg-brand text-white text-[14px] font-medium hover:brightness-110 transition">Apply{activeCount ? ` (${activeCount})` : ""}</button>
            {activeCount > 0 && <button onClick={clear} className="min-h-[44px] px-3 rounded-lg border border-line text-[13.5px] flex items-center gap-1.5 hover:bg-tint"><X size={14} /> Clear</button>}
          </div>
        </div>

        {loading ? <div className="space-y-2" aria-label="Loading activity"><div className="skel h-11 w-full" /><div className="skel h-11 w-full" /><div className="skel h-11 w-full" /></div>
          : items.length === 0 ? <EmptyNote>No events match these filters.</EmptyNote>
          : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[14px] min-w-[620px]">
                <thead>
                  <tr className="bg-soft text-left text-[13.5px] text-ink/80">
                    <th className="px-4 h-12 font-normal rounded-l-lg">Time</th><th className="px-3 font-normal">Person</th><th className="px-3 font-normal">Action</th>
                    <th className="px-3 font-normal">Item</th><th className="px-4 font-normal rounded-r-lg">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((e) => { const m = actionMeta(e.action); return (
                    <tr key={e.id} className="border-b border-line/70 last:border-0 hover:bg-tint/30 transition-colors">
                      <td className="px-4 py-3.5 whitespace-nowrap text-ink/80 tabular-nums" title={new Date(e.ts).toLocaleString()}>{fmtDay(e.ts)} <span className="text-muted">· {fmtTime(e.ts)}</span></td>
                      <td className="px-3 py-3.5"><span className="flex items-center gap-2.5 min-w-0"><span className="size-7 rounded-full bg-tint text-brand grid place-items-center text-[12px] font-medium shrink-0" aria-hidden="true">{e.actor_name.slice(0, 1).toUpperCase()}</span><span className="truncate">{e.actor_name}</span></span></td>
                      <td className="px-3 py-3.5"><StatusPill color={m.color}>{m.label}</StatusPill></td>
                      <td className="px-3 py-3.5 max-w-[320px] truncate text-ink/80">{detailText(e) ?? <span className="text-muted">—</span>}</td>
                      <td className="px-4 py-3.5 text-[12.5px] text-muted tabular-nums whitespace-nowrap">{e.ip ?? "—"}</td>
                    </tr>); })}
                </tbody>
              </table>
              <Pagination pager={pager} noun="events" />
            </div>
          )}
      </Panel>
    </section>
  );
}
