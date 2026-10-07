"use client";
import { WEEKDAYS_LONG, dayKey, fmtMin, monthCells, prio, toMin, type Plan } from "./cal";

/** Month view: 6×7 grid, up to 3 plan chips per day + "+N more" (jumps to that day). */
export default function MonthGrid({ month, todayKey, plansByDay, fileCounts, onCreate, onEdit, onDayClick }: {
  month: Date; todayKey: string; plansByDay: Map<string, Plan[]>; fileCounts?: Map<string, number>;
  onCreate: (dateKey: string) => void; onEdit: (p: Plan) => void; onDayClick: (d: Date) => void;
}) {
  const cells = monthCells(month);
  const rows = cells.slice(35).every((d) => d.getMonth() !== month.getMonth()) ? 5 : 6;
  return (
    <div className="flex-1 min-h-0 rounded-2xl border border-line bg-surface overflow-auto">
      <div className="min-w-[720px] h-full flex flex-col">
        <div className="grid grid-cols-7 border-b border-line sticky top-0 bg-surface z-10">
          {WEEKDAYS_LONG.map((w) => <span key={w} className="px-3 py-2.5 text-[10.5px] font-medium tracking-wider text-muted">{w}</span>)}
        </div>
        <div className="flex-1 grid grid-cols-7" style={{ gridTemplateRows: `repeat(${rows}, minmax(104px, 1fr))` }}>
          {cells.slice(0, rows * 7).map((d) => {
            const k = dayKey(d);
            const ps = [...(plansByDay.get(k) ?? [])].sort((a, b) => (toMin(a.plan_time) ?? -1) - (toMin(b.plan_time) ?? -1));
            const inMonth = d.getMonth() === month.getMonth();
            const isToday = k === todayKey;
            const wk = d.getDay() === 0 || d.getDay() === 6;
            const f = fileCounts?.get(k) ?? 0;
            return (
              <div key={k} onClick={(e) => { if (e.target === e.currentTarget) onCreate(k); }}
                className={`border-l border-b border-line p-1.5 min-w-0 cursor-cell first:border-l-0 [&:nth-child(7n+1)]:border-l-0 ${inMonth ? "" : "opacity-45"}`}
                style={{ background: isToday ? "color-mix(in srgb, var(--brand) 8%, var(--surface))" : wk ? "color-mix(in srgb, var(--ink) 3.5%, var(--surface))" : undefined }}>
                <button onClick={() => onDayClick(d)} aria-label={`Open ${d.toDateString()}`}
                  className={`size-7 rounded-full grid place-items-center text-[13px] tabular-nums hover:bg-tint ${isToday ? "bg-brand text-white font-medium hover:bg-brand" : ""}`}>{d.getDate()}</button>
                <div className="mt-1 space-y-1">
                  {ps.slice(0, 3).map((p) => {
                    const c = prio(p.priority).color;
                    const t = toMin(p.plan_time);
                    return (
                      <button key={p.id} onClick={() => onEdit(p)} title={p.title}
                        className={`w-full text-left truncate rounded px-1.5 py-[3px] text-[11.5px] hover:brightness-[.97] ${p.done ? "opacity-55 line-through" : ""}`}
                        style={{ borderLeft: `3px solid ${c}`, background: `color-mix(in srgb, ${c} 13%, var(--surface))` }}>
                        {t !== null && <span className="tabular-nums text-muted mr-1">{fmtMin(t, false)}</span>}{p.title}
                      </button>
                    );
                  })}
                  {ps.length > 3 && <button onClick={() => onDayClick(d)} className="text-[11.5px] text-brand font-medium px-1">+{ps.length - 3} more</button>}
                  {f > 0 && <span className="block text-[10.5px] text-muted px-1">{f} file{f === 1 ? "" : "s"}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
