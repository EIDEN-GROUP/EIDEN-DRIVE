"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, FileText, Plus, Search, X } from "lucide-react";
import MiniMonth from "@/components/calendar/MiniMonth";
import TimeGrid from "@/components/calendar/TimeGrid";
import MonthGrid from "@/components/calendar/MonthGrid";
import MultiMonth from "@/components/calendar/MultiMonth";
import PlanModal, { draftFrom, type Draft } from "@/components/calendar/PlanModal";
import { AgendaItem } from "@/components/calendar/PlanBits";
import { addDays, dayKey, parseKey, startOfWeek, toMin, type Plan, type View } from "@/components/calendar/cal";

interface CalFile { id: string; updated?: string; updated_at?: string; mime?: string }
const VIEWS: { id: View; label: string; this: string }[] = [
  { id: "day", label: "Day", this: "Today" },
  { id: "week", label: "Week", this: "This Week" },
  { id: "month", label: "Month", this: "This Month" },
  { id: "quarter", label: "Quarter", this: "This Quarter" },
  { id: "year", label: "Year", this: "This Year" }
];
const pad = (n: number) => String(n).padStart(2, "0");
const ddmmyyyy = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const byTime = (a: Plan, b: Plan) => (toMin(a.plan_time) ?? -1) - (toMin(b.plan_time) ?? -1);

// Calendar: schedule view in the style of the reference — mini month + agenda on the left,
// Day / Week / Month / Quarter / Year on the right. Data: personal plans (/api/plans) and,
// optionally, file activity (file_index.updated_at = "added or last changed").
export default function CalendarClient() {
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(() => dayKey(new Date()));
  const [mini, setMini] = useState(() => new Date());
  const [plans, setPlans] = useState<Plan[]>([]);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [files, setFiles] = useState<CalFile[] | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [today, setToday] = useState(() => new Date());

  const cur = parseKey(cursor);
  const todayKey = dayKey(today);

  const loadPlans = useCallback(async () => {
    const r = await fetch("/api/plans").then((x) => x.json().catch(() => ({})));
    setPlans(r.results ?? []);
  }, []);
  useEffect(() => {
    let dead = false;
    (async () => {
      const [fr, pr] = await Promise.all([
        fetch("/api/folders").then((r) => r.json().catch(() => ({}))),
        fetch("/api/plans").then((r) => r.json().catch(() => ({})))
      ]);
      if (dead) return;
      setFolders(fr.results ?? []);
      setPlans(pr.results ?? []);
      setLoading(false);
    })();
    // Phones get the Day view (a 7-column grid doesn't fit); roll "today" over at midnight.
    if (window.matchMedia("(max-width: 767px)").matches) setView("day");
    const t = setInterval(() => setToday(new Date()), 60_000);
    return () => { dead = true; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!showFiles || files !== null) return;
    fetch("/api/drive?q=&limit=100").then((r) => r.json().catch(() => ({}))).then((d) => {
      setFiles(((d.results ?? []) as CalFile[]).filter((f) => !f.id.startsWith("g:") && f.mime !== "application/vnd.google-apps.folder"));
    }).catch(() => setFiles([]));
  }, [showFiles, files]);
  useEffect(() => { setMini(parseKey(cursor)); }, [cursor]);

  const folderName = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);
  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!needle) return plans;
    return plans.filter((p) => `${p.title} ${p.detail ?? ""} ${p.plan_date} ${p.priority} ${p.folder ? folderName.get(p.folder) ?? "" : ""}`.toLowerCase().includes(needle));
  }, [plans, needle, folderName]);
  const plansByDay = useMemo(() => {
    const m = new Map<string, Plan[]>();
    for (const p of visible) { if (!m.has(p.plan_date)) m.set(p.plan_date, []); m.get(p.plan_date)!.push(p); }
    return m;
  }, [visible]);
  const counts = useMemo(() => new Map([...plansByDay].map(([k, v]) => [k, v.length])), [plansByDay]);
  const fileCounts = useMemo(() => {
    if (!showFiles || !files) return undefined;
    const m = new Map<string, number>();
    for (const f of files) { const u = f.updated_at ?? f.updated; if (!u) continue; const k = dayKey(new Date(u)); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  }, [files, showFiles]);

  // ── navigation ──
  function step(dir: 1 | -1) {
    const d = new Date(cur);
    if (view === "day") d.setDate(d.getDate() + dir);
    else if (view === "week") d.setDate(d.getDate() + 7 * dir);
    else if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "quarter") d.setMonth(d.getMonth() + 3 * dir);
    else d.setFullYear(d.getFullYear() + dir);
    setCursor(dayKey(d));
  }
  const goDay = (d: Date) => { setCursor(dayKey(d)); setView("day"); };
  const goMonth = (d: Date) => { setCursor(dayKey(new Date(d.getFullYear(), d.getMonth(), 1))); setView("month"); };
  const qStart = Math.floor(cur.getMonth() / 3) * 3;
  const title = view === "day" ? cur.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : view === "year" ? String(cur.getFullYear())
    : view === "quarter" ? `Q${qStart / 3 + 1} ${cur.getFullYear()}`
    : cur.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const weekDays = useMemo(() => { const s = startOfWeek(cur); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }, [cursor]); // eslint-disable-line react-hooks/exhaustive-deps
  const sub = (() => {
    const isNow = (a: Date, b: Date) => view === "week" ? dayKey(startOfWeek(a)) === dayKey(startOfWeek(b))
      : view === "day" ? dayKey(a) === dayKey(b)
      : view === "month" ? a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
      : view === "quarter" ? a.getFullYear() === b.getFullYear() && Math.floor(a.getMonth() / 3) === Math.floor(b.getMonth() / 3)
      : a.getFullYear() === b.getFullYear();
    if (isNow(cur, today)) return VIEWS.find((v) => v.id === view)!.this;
    if (view === "week") return `${weekDays[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
    if (view === "day") return cur.toLocaleDateString("en-GB", { weekday: "long" });
    return title;
  })();

  // ── plan actions ──
  const newPlan = (date = cursor, time = "") => setDraft({ title: "", date, time, priority: "normal", folder: "", detail: "" });
  async function toggle(p: Plan) {
    setPlans((prev) => prev.map((x) => (x.id === p.id ? { ...x, done: !x.done } : x)));
    const r = await fetch("/api/plans", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: p.id, done: !p.done }) });
    if (!r.ok) loadPlans();
  }

  // ── agenda groups (left panel) ──
  const agenda = useMemo(() => {
    const out: { key: string; head: string; sub: string; tone?: "today" | "late"; items: Plan[] }[] = [];
    if (needle) {
      const sorted = [...visible].sort((a, b) => a.plan_date.localeCompare(b.plan_date) || byTime(a, b)).slice(0, 40);
      const m = new Map<string, Plan[]>();
      for (const p of sorted) { if (!m.has(p.plan_date)) m.set(p.plan_date, []); m.get(p.plan_date)!.push(p); }
      for (const [k, items] of m) { const d = parseKey(k); out.push({ key: k, head: d.toLocaleDateString("en-GB", { weekday: "long" }), sub: ddmmyyyy(d), items }); }
      return out;
    }
    const late = plans.filter((p) => !p.done && p.plan_date < todayKey).sort((a, b) => a.plan_date.localeCompare(b.plan_date) || byTime(a, b));
    if (late.length) out.push({ key: "late", head: "OVERDUE", sub: `${late.length} plan${late.length === 1 ? "" : "s"}`, tone: "late", items: late.slice(0, 5) });
    for (let i = 0; i < 14 && out.length < 6; i++) {
      const d = addDays(today, i), k = dayKey(d);
      const items = [...(plansByDay.get(k) ?? [])].sort(byTime);
      if (!items.length) continue;
      out.push({ key: k, head: i === 0 ? "TODAY" : i === 1 ? "TOMORROW" : d.toLocaleDateString("en-GB", { weekday: "long" }), sub: ddmmyyyy(d), tone: i === 0 ? "today" : undefined, items });
    }
    return out;
  }, [needle, visible, plans, plansByDay, today, todayKey]);

  const months = view === "quarter" ? [0, 1, 2].map((i) => new Date(cur.getFullYear(), qStart + i, 1))
    : Array.from({ length: 12 }, (_, i) => new Date(cur.getFullYear(), i, 1));
  const circle = "size-10 rounded-full grid place-items-center bg-tint text-brand hover:bg-brand hover:text-white transition-colors";

  return (
    <section className="h-full min-h-[560px] flex rounded-2xl border border-line bg-surface overflow-hidden" aria-label="Calendar">
      {/* ── Left: mini month + agenda ── */}
      <aside className="hidden lg:flex w-[336px] xl:w-[364px] shrink-0 flex-col bg-soft border-r border-line overflow-y-auto" aria-label="Mini calendar and agenda">
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[28px] leading-none font-medium">
              {mini.toLocaleDateString("en-GB", { month: "long" })}
              {mini.getFullYear() !== today.getFullYear() && <span className="ml-2 text-[15px] text-muted font-normal">{mini.getFullYear()}</span>}
            </h2>
            <div className="flex gap-2">
              <button className={circle} aria-label="Previous month" onClick={() => setMini(new Date(mini.getFullYear(), mini.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
              <button className={circle} aria-label="Next month" onClick={() => setMini(new Date(mini.getFullYear(), mini.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
            </div>
          </div>
          <MiniMonth big month={mini} selected={cur} today={today} counts={counts} onPick={(d) => { setCursor(dayKey(d)); if (view === "year" || view === "quarter") setView("week"); }} />
        </div>
        <div className="mx-5 border-t border-line" />
        <div className="px-5 py-3 flex-1">
          {loading && <div className="space-y-3" aria-label="Loading plans"><div className="skel h-14 w-full" /><div className="skel h-14 w-full" /></div>}
          {!loading && agenda.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-[14px] text-muted">{needle ? "No plans match your search." : "Nothing planned for the next two weeks."}</p>
              {!needle && <button onClick={() => newPlan(todayKey)} className="mt-3 min-h-[44px] px-4 rounded-lg bg-brand text-white text-[13.5px] font-medium inline-flex items-center gap-1.5"><Plus size={16} /> New plan</button>}
            </div>
          )}
          {agenda.map((g) => (
            <div key={g.key} className="mb-2">
              <p className="flex items-baseline justify-between text-[13px] pt-1.5 pb-0.5">
                <span><span className={`font-medium tracking-wide ${g.tone === "today" ? "text-brand" : g.tone === "late" ? "text-danger" : "text-ink"}`}>{g.head}</span>
                  <span className={`ml-2 ${g.tone === "today" ? "text-brand" : "text-muted"}`}>{g.sub}</span></span>
                {g.tone !== "late" && <span className="text-[11.5px] text-muted tabular-nums">{g.items.length} plan{g.items.length === 1 ? "" : "s"}</span>}
              </p>
              <div className="divide-y divide-line/60">
                {g.items.map((p) => (
                  <AgendaItem key={p.id} plan={p} folder={p.folder ? folderName.get(p.folder) : undefined}
                    onOpen={() => setDraft(draftFrom(p))} onToggle={() => toggle(p)} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="sticky bottom-0 bg-soft border-t border-line px-5 py-3 flex items-center gap-3">
          <button onClick={() => newPlan()} className="flex-1 min-h-[44px] rounded-lg bg-brand text-white text-[14px] font-medium flex items-center justify-center gap-1.5 hover:brightness-110 transition">
            <Plus size={17} /> New plan
          </button>
          <button onClick={() => setShowFiles((v) => !v)} aria-pressed={showFiles} title="Overlay days with added / changed files"
            className={`min-h-[44px] px-3 rounded-lg border text-[13px] flex items-center gap-1.5 transition-colors ${showFiles ? "border-brand bg-tint text-brand font-medium" : "border-line bg-surface hover:bg-tint"}`}>
            <FileText size={15} /> Files
          </button>
        </div>
      </aside>

      {/* ── Right: header + view ── */}
      <div className="flex-1 min-w-0 flex flex-col p-4 sm:px-6 sm:py-5 gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-[28px] sm:text-[32px] leading-none font-medium tracking-tight mr-1">{title}</h1>
          <div className="flex items-center gap-2">
            <button className={circle} aria-label="Previous" onClick={() => step(-1)}><ChevronLeft size={18} /></button>
            <button onClick={() => setCursor(dayKey(new Date()))} className="min-h-[42px] min-w-[132px] px-4 rounded-lg border border-line bg-surface text-[14.5px] hover:bg-tint transition-colors">
              {VIEWS.find((v) => v.id === view)!.this}
            </button>
            <button className={circle} aria-label="Next" onClick={() => step(1)}><ChevronRight size={18} /></button>
          </div>
          <div role="group" aria-label="Calendar view" className="flex rounded-lg border border-line overflow-hidden bg-surface">
            {VIEWS.map((v) => (
              <button key={v.id} onClick={() => setView(v.id)} aria-pressed={view === v.id}
                className={`min-h-[42px] px-3 sm:px-5 text-[14px] flex items-center gap-1.5 border-l border-line first:border-l-0 transition-colors ${view === v.id ? "bg-tint text-brand font-medium" : "hover:bg-tint/60"}`}>
                {view === v.id && <Check size={14} strokeWidth={2.5} />}{v.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[180px] max-w-[300px] ml-auto">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search date, event, etc…" aria-label="Search plans"
              className="w-full min-h-[42px] pl-10 pr-9 rounded-lg border border-line bg-surface text-[13.5px] placeholder:text-muted focus:border-brand focus:outline-none" />
            {q && <button onClick={() => setQ("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 size-8 grid place-items-center rounded-md hover:bg-tint text-muted"><X size={15} /></button>}
          </div>
          <button onClick={() => newPlan()} aria-label="New plan" className="lg:hidden size-[42px] rounded-lg bg-brand text-white grid place-items-center"><Plus size={18} /></button>
        </div>

        <h2 className="text-[20px] font-medium -mb-1">{sub}</h2>

        {loading ? (
          <div className="flex-1 skel rounded-2xl" aria-label="Loading calendar" />
        ) : view === "week" || view === "day" ? (
          <TimeGrid key={view + (view === "day" ? cursor : "")} days={view === "week" ? weekDays : [cur]} todayKey={todayKey} plansByDay={plansByDay} fileCounts={fileCounts}
            onCreate={(k, t) => newPlan(k, t)} onEdit={(p) => setDraft(draftFrom(p))} onDayClick={goDay} />
        ) : view === "month" ? (
          <MonthGrid month={cur} todayKey={todayKey} plansByDay={plansByDay} fileCounts={fileCounts}
            onCreate={(k) => newPlan(k)} onEdit={(p) => setDraft(draftFrom(p))} onDayClick={goDay} />
        ) : (
          <MultiMonth months={months} selected={cur} today={today} counts={counts} onPickDay={goDay} onPickMonth={goMonth} />
        )}
      </div>

      {draft && <PlanModal key={draft.id ?? "new"} draft={draft} folders={folders} onClose={() => setDraft(null)} onSaved={loadPlans} />}
    </section>
  );
}
