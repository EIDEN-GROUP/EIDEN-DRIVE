"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X, CalendarPlus, Check, Trash2, FolderClosed } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import type { PlanRow } from "@/app/api/plans/route";

interface CalFile { id: string; name: string; updated?: string; updated_at?: string; folder?: string | null }
interface Folder { id: string; name: string }

type Mode = "month" | "week" | "day";
const PRIORITIES = ["low", "normal", "high"] as const;

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseKey = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };

// Calendar: every file by the day it landed/changed, plus personal plans.
// Files use file_index.updated_at ("added or last changed" — honest label, the
// index doesn't keep a separate birth date). Plan mode overlays your own plans.
export default function CalendarPage() {
  const [mode, setMode] = useState<Mode>("month");
  const [planMode, setPlanMode] = useState(false);
  const [cursor, setCursor] = useState(() => dayKey(new Date()));
  const [files, setFiles] = useState<CalFile[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    (async () => {
      const [fr, dr, pr] = await Promise.all([
        fetch("/api/folders").then((r) => r.json().catch(() => ({}))),
        fetch("/api/drive?q=&limit=200").then((r) => r.json().catch(() => ({}))),
        fetch("/api/plans").then((r) => r.json().catch(() => ({})))
      ]);
      if (dead) return;
      setFolders(fr.results ?? []);
      setFiles((dr.results ?? []).filter((f: CalFile & { mime?: string }) => !f.id.startsWith("g:") && f.mime !== "application/vnd.google-apps.folder"));
      setPlans(pr.results ?? []);
      setLoading(false);
    })();
    return () => { dead = true; };
  }, []);

  const folderName = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);
  const visibleFiles = useMemo(
    () => folderFilter ? files.filter((f) => f.folder === folderFilter) : files,
    [files, folderFilter]
  );
  const byDay = useMemo(() => {
    const m = new Map<string, CalFile[]>();
    for (const f of visibleFiles) {
      const u = f.updated_at ?? f.updated;
      if (!u) continue;
      const k = dayKey(new Date(u));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f);
    }
    return m;
  }, [visibleFiles]);
  const plansByDay = useMemo(() => {
    const m = new Map<string, PlanRow[]>();
    for (const p of plans) {
      if (!m.has(p.plan_date)) m.set(p.plan_date, []);
      m.get(p.plan_date)!.push(p);
    }
    return m;
  }, [plans]);

  const cur = parseKey(cursor);
  const monthCells = useMemo(() => {
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const start = new Date(first);
    start.setDate(start.getDate() - ((first.getDay() + 6) % 7)); // Monday-first
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cur]);
  const weekCells = useMemo(() => {
    const s = new Date(cur);
    s.setDate(s.getDate() - ((cur.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(s);
      d.setDate(s.getDate() + i);
      return d;
    });
  }, [cur]);

  function step(dir: 1 | -1) {
    const d = new Date(cur);
    if (mode === "month") d.setMonth(d.getMonth() + dir);
    else if (mode === "week") d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + dir);
    setCursor(dayKey(d));
  }
  const title = mode === "month"
    ? cur.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : mode === "week"
      ? `Week of ${weekCells[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
      : cur.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  async function reloadPlans() {
    const pr = await fetch("/api/plans").then((r) => r.json().catch(() => ({})));
    setPlans(pr.results ?? []);
  }

  const cells = mode === "month" ? monthCells : mode === "week" ? weekCells : [cur];
  const todayK = dayKey(new Date());

  return (
    <section className="px-1 pt-1 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h1 className="page-title flex-1 min-w-[140px]">Calendar</h1>
        <div role="group" aria-label="View" className="flex rounded-md overflow-hidden border border-line">
          {(["month", "week", "day"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
              className={`min-h-[40px] px-3 text-[13px] capitalize ${mode === m ? "bg-tint text-brand font-medium" : "text-muted hover:bg-tint/60"}`}>{m}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 min-h-[40px] px-2 text-[13px] cursor-pointer select-none">
          <button role="switch" aria-checked={planMode} aria-label="Plan mode" onClick={() => setPlanMode((v) => !v)}
            className={`w-11 h-6 rounded-full p-0.5 transition-colors ${planMode ? "bg-brand" : "bg-line"}`}>
            <span className={`block size-5 rounded-full bg-white shadow transition-transform ${planMode ? "translate-x-5" : ""}`} />
          </button>
          Plan mode
        </label>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => step(-1)} aria-label="Previous" className="size-11 grid place-items-center rounded-md hover:bg-tint"><ChevronLeft size={18} /></button>
        <p className="text-[14px] font-medium flex-1 text-center">{title}</p>
        <button onClick={() => step(1)} aria-label="Next" className="size-11 grid place-items-center rounded-md hover:bg-tint"><ChevronRight size={18} /></button>
        <button onClick={() => setCursor(dayKey(new Date()))} className="min-h-[44px] px-3 rounded-md border border-line text-[13px] hover:bg-tint">Today</button>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-3" role="group" aria-label="Folder filter">
        <button onClick={() => setFolderFilter(null)} aria-pressed={folderFilter === null}
          className={`min-h-[40px] px-3 rounded-full text-[12.5px] border ${folderFilter === null ? "bg-brand text-white border-brand" : "border-line hover:bg-tint"}`}>All folders</button>
        {folders.map((f) => (
          <button key={f.id} onClick={() => setFolderFilter((v) => v === f.id ? null : f.id)} aria-pressed={folderFilter === f.id}
            className={`min-h-[40px] px-3 rounded-full text-[12.5px] border flex items-center gap-1 ${folderFilter === f.id ? "bg-brand text-white border-brand" : "border-line hover:bg-tint"}`}>
            <FolderClosed size={12} /> {f.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-7 gap-1.5" aria-label="Loading calendar">
          {Array.from({ length: 14 }, (_, i) => <div key={i} className="skel h-20" />)}
        </div>
      ) : (
        <>
          <div className={`grid gap-1.5 ${mode === "day" ? "grid-cols-1" : "grid-cols-7"}`}>
            {(mode === "day" ? [] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]).map((d) => (
              <p key={d} className="text-center text-[11px] text-muted font-medium py-1">{d}</p>
            ))}
            {cells.map((d) => {
              const k = dayKey(d);
              const fs = byDay.get(k) ?? [];
              const ps = plansByDay.get(k) ?? [];
              const inMonth = mode !== "month" || d.getMonth() === cur.getMonth();
              return (
                <button key={k + mode} onClick={() => setDayOpen(k)}
                  className={`min-h-[64px] rounded-lg border p-1.5 text-left align-top hover:border-brand transition-colors
                    ${k === todayK ? "border-brand ring-1 ring-brand" : "border-line"} ${inMonth ? "bg-surface" : "opacity-40"}`}>
                  <span className={`text-[12px] font-medium ${k === todayK ? "text-brand" : ""}`}>{d.getDate()}</span>
                  {(fs.length > 0 || (planMode && ps.length > 0)) && (
                    <span className="mt-1 flex gap-1 flex-wrap">
                      {fs.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-tint text-brand font-medium">{fs.length} file{fs.length === 1 ? "" : "s"}</span>}
                      {planMode && ps.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">{ps.length} plan{ps.length === 1 ? "" : "s"}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] text-muted">File days use “added or last changed”. Click any day for details{planMode ? " and to add plans" : ""}.</p>
        </>
      )}

      {dayOpen && (
        <DayModal dateKey={dayOpen} files={byDay.get(dayOpen) ?? []} plans={plansByDay.get(dayOpen) ?? []}
          folders={folders} folderName={folderName} planMode={planMode}
          onClose={() => setDayOpen(null)} onChanged={reloadPlans} />
      )}
    </section>
  );
}

function DayModal({ dateKey, files, plans, folders, folderName, planMode, onClose, onChanged }: {
  dateKey: string; files: CalFile[]; plans: PlanRow[];
  folders: Folder[]; folderName: Map<string, string>; planMode: boolean;
  onClose: () => void; onChanged: () => void;
}) {
  const [form, setForm] = useState(false);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("normal");
  const [folder, setFolder] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const label = parseKey(dateKey).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  async function addPlan() {
    if (!title.trim()) return;
    setBusy(true);
    const r = await fetch("/api/plans", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim(), detail: detail.trim() || null, plan_date: dateKey, plan_time: time || null, priority, folder: folder || null })
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't add plan.", tone: "err" }); return; }
    setTitle(""); setTime(""); setDetail(""); setFolder(""); setPriority("normal"); setForm(false);
    toast({ text: "Plan added.", tone: "ok" });
    onChanged();
  }

  async function toggleDone(p: PlanRow) {
    await fetch("/api/plans", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: p.id, done: !p.done }) });
    onChanged();
  }
  async function delPlan(p: PlanRow) {
    await fetch("/api/plans", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: p.id }) });
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="pop-in relative w-full max-w-md max-h-[85vh] rounded-xl bg-surface border border-line shadow-pop flex flex-col overflow-hidden">
        <div className="flex items-center px-4 min-h-[56px] border-b border-line">
          <p className="text-[14px] font-medium flex-1">{label}</p>
          <button onClick={onClose} aria-label="Close day details" className="size-11 grid place-items-center rounded-md hover:bg-tint"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div>
            <p className="text-[12px] text-muted font-medium mb-1.5">{files.length} file{files.length === 1 ? "" : "s"} added / changed</p>
            {files.length === 0 && <p className="text-[13px] text-muted">Nothing landed this day.</p>}
            {files.slice(0, 30).map((f) => (
              <div key={f.id} className="flex items-center gap-2 py-1.5 border-b border-line/60 text-[13px]">
                <span className="truncate flex-1">{f.name}</span>
                {f.folder && folderName.get(f.folder) && <span className="text-[11px] text-muted shrink-0">{folderName.get(f.folder)}</span>}
              </div>
            ))}
          </div>
          <div>
            <div className="flex items-center mb-1.5">
              <p className="text-[12px] text-muted font-medium flex-1">{plans.length} plan{plans.length === 1 ? "" : "s"}</p>
              {planMode && !form && (
                <button onClick={() => setForm(true)} className="min-h-[40px] px-2.5 text-[12.5px] text-brand font-medium flex items-center gap-1"><Plus size={14} /> Add plan</button>
              )}
            </div>
            {plans.length === 0 && !form && <p className="text-[13px] text-muted">{planMode ? "No plans — add one." : "Turn on Plan mode to schedule something here."}</p>}
            {plans.map((p) => (
              <div key={p.id} className={`flex items-start gap-2 py-2 border-b border-line/60 ${p.done ? "opacity-55" : ""}`}>
                <button onClick={() => toggleDone(p)} aria-label={p.done ? `Reopen ${p.title}` : `Mark ${p.title} done`}
                  className={`mt-0.5 size-6 grid place-items-center rounded border shrink-0 ${p.done ? "bg-brand border-brand text-white" : "border-line"}`}>
                  {p.done && <Check size={13} />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13.5px] font-medium ${p.done ? "line-through" : ""}`}>{p.title}</p>
                  <p className="text-[11.5px] text-muted">
                    {[p.plan_time, p.priority !== "normal" ? p.priority : null, p.folder ? folderName.get(p.folder) : null].filter(Boolean).join(" · ")}
                  </p>
                  {p.detail && <p className="text-[12.5px] text-ink/80 mt-0.5">{p.detail}</p>}
                </div>
                <button onClick={() => delPlan(p)} aria-label={`Delete ${p.title}`} className="size-9 grid place-items-center rounded-md hover:bg-tint text-muted shrink-0"><Trash2 size={14} /></button>
              </div>
            ))}
            {form && (
              <div className="mt-2 p-3 rounded-lg border border-line bg-soft space-y-2.5">
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Plan title"
                  aria-label="Plan title" className="w-full min-h-[44px] rounded-md border border-line bg-surface px-2.5 text-[13px]" />
                <div className="flex gap-2">
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time (optional)"
                    className="min-h-[44px] rounded-md border border-line bg-surface px-2 text-[13px]" />
                  <select value={priority} onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])} aria-label="Priority"
                    className="min-h-[44px] rounded-md border border-line bg-surface px-2 text-[13px]">
                    {PRIORITIES.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
                  </select>
                  <select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Linked folder (optional)"
                    className="min-h-[44px] flex-1 rounded-md border border-line bg-surface px-2 text-[13px] min-w-0">
                    <option value="">No folder</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <textarea value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={2000} rows={2} placeholder="Notes (optional)"
                  aria-label="Plan notes" className="w-full rounded-md border border-line bg-surface px-2.5 py-2 text-[13px]" />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setForm(false)} className="min-h-[44px] px-3 rounded-md border border-line text-[13px]">Cancel</button>
                  <button onClick={addPlan} disabled={!title.trim() || busy}
                    className="min-h-[44px] px-3 rounded-md bg-brand text-white text-[13px] font-medium disabled:opacity-50 flex items-center gap-1">
                    <CalendarPlus size={14} /> {busy ? "Adding…" : "Add plan"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
