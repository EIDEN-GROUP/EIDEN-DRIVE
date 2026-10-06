"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";

interface Entry {
  id: number; actor_name: string; action: string; file_id: string | null;
  detail: Record<string, unknown> | null; ip: string | null; ts: string;
}

const ACTION_STYLE: Record<string, { dot: string; verb: string }> = {
  add: { dot: "#22c32e", verb: "added" },
  edit: { dot: "#22c32e", verb: "edited" },
  rename: { dot: "#0ea5a4", verb: "renamed" },
  download: { dot: "#7c3aed", verb: "downloaded" },
  trash: { dot: "#f59e0b", verb: "moved to Recovery Bin" },
  restore: { dot: "#22c32e", verb: "restored" },
  "perm-delete": { dot: "#e5322d", verb: "deleted permanently" },
  share: { dot: "#7c3aed", verb: "shared" },
  view: { dot: "#94a3b8", verb: "viewed" },
  "vault-view": { dot: "#e5322d", verb: "opened in Vault" },
  login: { dot: "#22c32e", verb: "signed in" },
};

const ALL_ACTIONS = Object.keys(ACTION_STYLE);

function time(d: string): string {
  const t = new Date(d);
  return isNaN(t.getTime()) ? "--" : t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function dayLabel(iso: string, todayK: string, yestK: string): string {
  const d = new Date(iso);
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (k === todayK) return "TODAY";
  if (k === yestK) return "YESTERDAY";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();
}
function detailText(e: Entry): string | null {
  const d = e.detail ?? {};
  if (typeof d.name === "string") return d.name;
  if (typeof d.sync === "string") return `sync · ${d.sync}`;
  if (typeof d.copy_of === "string") return "a copy";
  if (typeof d.decision === "string") return `decision: ${d.decision}`;
  if (typeof d.users === "string") return "a user account";
  return null;
}

// Timeline feed: day-grouped like a changelog, searchable and filterable by
// action, actor, and date range. Filters hit the server; the text box refines.
export default function ActivityClient() {
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ q: "", action: "", actor: "", from: "", to: "" });

  async function run(f = applied) {
    setLoading(true);
    const sp = new URLSearchParams({ limit: "200" });
    if (f.q) sp.set("q", f.q);
    if (f.action) sp.set("action", f.action);
    if (f.actor) sp.set("actor", f.actor);
    if (f.from) sp.set("from", f.from);
    if (f.to) sp.set("to", f.to);
    const r = await fetch(`/api/activity?${sp}`);
    const d = await r.json().catch(() => ({}));
    setItems(d.results ?? []);
    setLoading(false);
  }
  useEffect(() => { run(); }, []);

  function apply() {
    const f = { q: q.trim(), action, actor: actor.trim(), from, to };
    setApplied(f);
    run(f);
  }
  function clear() {
    setQ(""); setAction(""); setActor(""); setFrom(""); setTo("");
    const f = { q: "", action: "", actor: "", from: "", to: "" };
    setApplied(f);
    run(f);
  }
  const activeCount = [applied.q, applied.action, applied.actor, applied.from, applied.to].filter(Boolean).length;

  const groups = useMemo(() => {
    const now = new Date();
    const k = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const todayK = k(now);
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const yestK = k(y);
    const m = new Map<string, Entry[]>();
    for (const e of items) {
      const label = dayLabel(e.ts, todayK, yestK);
      if (!m.has(label)) m.set(label, []);
      m.get(label)!.push(e);
    }
    return [...m.entries()];
  }, [items]);

  const input = "min-h-[44px] rounded-md border border-line bg-surface px-3 text-[13px] focus:border-brand focus:outline-none";

  return (
    <section className="px-1 pt-1 max-w-3xl mx-auto">
      <h1 className="page-title mb-1">Activity</h1>
      <p className="text-[13px] text-muted mb-4">Every audited action, newest first.</p>

      <div className="card p-3 sm:p-4 mb-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
            placeholder="Search actor, action, IP…" aria-label="Search activity"
            className={`${input} w-full pl-9`} />
        </div>
        <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action" className={input}>
            <option value="">All actions</option>
            {ALL_ACTIONS.map((a) => <option key={a} value={a}>{ACTION_STYLE[a].verb}</option>)}
          </select>
          <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Actor name"
            onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
            aria-label="Filter by actor" className={input} />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className={input} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className={input} />
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <button onClick={apply} className="min-h-[44px] px-4 rounded-md bg-brand text-white text-[13px] font-medium">
            Apply{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
          {activeCount > 0 && (
            <button onClick={clear} className="min-h-[44px] px-3 rounded-md border border-line text-[13px] flex items-center gap-1.5 hover:bg-tint">
              <X size={14} /> Clear
            </button>
          )}
          <span className="ml-auto text-[12px] text-muted">{items.length} event{items.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3" aria-label="Loading activity">
          <div className="skel h-5 w-24" /><div className="skel h-12 w-full" /><div className="skel h-12 w-full" />
        </div>
      ) : groups.length === 0 ? (
        <p className="text-[14px] text-muted py-8 text-center">No events match these filters.</p>
      ) : (
        groups.map(([day, list]) => (
          <div key={day} className="mb-5">
            <p className="text-[11px] font-semibold tracking-wider text-muted mb-2">{day}</p>
            <ol className="relative border-l border-line ml-1.5 space-y-0.5">
              {list.map((e) => {
                const st = ACTION_STYLE[e.action] ?? { dot: "#94a3b8", verb: e.action };
                const extra = detailText(e);
                return (
                  <li key={e.id} className="relative pl-6 py-2 border-b border-line/50 last:border-0">
                    <span className="absolute left-[-5px] top-[14px] size-2.5 rounded-full ring-4 ring-surface" style={{ background: st.dot }} />
                    <p className="text-[13.5px] leading-snug">
                      <span className="text-muted tabular-nums mr-2">{time(e.ts)}</span>
                      <strong className="font-medium">{e.actor_name}</strong>
                      {" "}{st.verb}{extra ? <> <span className="text-brand">{extra}</span></> : null}
                    </p>
                    {e.ip && <p className="text-[11px] text-muted mt-0.5">{e.ip}</p>}
                  </li>
                );
              })}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}
