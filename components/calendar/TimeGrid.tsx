"use client";
import { useEffect, useRef, useState } from "react";
import {
  HOUR, WEEKDAYS_LONG, dayKey, fmtMin, gmtLabel, hourLabel, layoutDay, prio, toMin, type Plan
} from "./cal";

const SIDE = 48; // px: time gutters
const MIN_COL = 84; // px: narrowest day column before the grid scrolls sideways

/** Day / Week time grid — mirrors the reference: sticky day headers, hour labels on both sides, tinted weekend + today columns. */
export default function TimeGrid({ days, todayKey, plansByDay, fileCounts, onCreate, onEdit, onDayClick }: {
  days: Date[]; todayKey: string; plansByDay: Map<string, Plan[]>; fileCounts?: Map<string, number>;
  onCreate: (dateKey: string, time: string) => void; onEdit: (p: Plan) => void; onDayClick: (d: Date) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [wide, setWide] = useState(true); // right-hand time gutter only when there is room
  const cols = `${SIDE}px repeat(${days.length}, minmax(0, 1fr))${wide ? ` ${SIDE}px` : ""}`;
  const gmt = gmtLabel();

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= 940 || days.length === 1));
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const n = new Date();
    const focus = days.some((d) => dayKey(d) === dayKey(n)) ? Math.max(0, n.getHours() - 2) : 7;
    el.scrollTop = focus * HOUR - 4;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lines = {
    backgroundImage: "linear-gradient(to bottom, var(--line) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--line) 50%, transparent) 1px, transparent 1px)",
    backgroundSize: `100% ${HOUR}px, 100% ${HOUR / 2}px`
  } as const;
  const tone = (d: Date, k: string) =>
    k === todayKey ? "color-mix(in srgb, var(--brand) 9%, var(--surface))"
      : d.getDay() === 0 || d.getDay() === 6 ? "color-mix(in srgb, var(--ink) 4%, var(--surface))" : "var(--surface)";
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const untimed = days.map((d) => (plansByDay.get(dayKey(d)) ?? []).filter((p) => toMin(p.plan_time) === null));
  const anyAllDay = untimed.some((u) => u.length) || (fileCounts && days.some((d) => (fileCounts.get(dayKey(d)) ?? 0) > 0));

  return (
    <div className="flex-1 min-h-0 rounded-2xl border border-line bg-surface overflow-hidden flex flex-col">
      <div ref={scroller} className="flex-1 overflow-auto">
        <div style={{ minWidth: days.length > 1 ? SIDE + (wide ? SIDE : 0) + MIN_COL * days.length : 360 }}>
          {/* sticky header */}
          <div className="sticky top-0 z-20 bg-surface" style={{ display: "grid", gridTemplateColumns: cols }}>
            <div className="px-1 pt-3 text-[10px] leading-tight text-muted text-right">{!wide && gmt}</div>
            {days.map((d) => {
              const k = dayKey(d);
              const n = (plansByDay.get(k) ?? []).length;
              const isToday = k === todayKey;
              return (
                <button key={k} onClick={() => onDayClick(d)} aria-label={`Open ${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`}
                  className="text-left px-3 pt-3 pb-2 border-l border-line hover:bg-tint/50 transition-colors"
                  style={{ background: tone(d, k) }}>
                  <span className="flex items-baseline justify-between gap-1">
                    <span className="text-[10.5px] font-medium tracking-wider text-muted">{WEEKDAYS_LONG[d.getDay()]}</span>
                    {n > 0 && <span className="text-[11px] text-muted tabular-nums">{n} plan{n === 1 ? "" : "s"}</span>}
                  </span>
                  <span className={`block text-[28px] leading-[1.1] font-semibold tabular-nums ${isToday ? "text-brand" : ""}`}>{d.getDate()}</span>
                </button>
              );
            })}
            {wide && <div className="px-2 pt-3 text-[10.5px] leading-tight text-muted border-l border-line">{gmt.split(" ")[0]}<br />{gmt.split(" ")[1]}</div>}
          </div>

          {/* all-day / untimed + file activity */}
          {anyAllDay && (
            <div className="border-y border-line" style={{ display: "grid", gridTemplateColumns: cols }}>
              <div className="px-1 py-1.5 text-[10px] text-muted text-right self-center">all-day</div>
              {days.map((d, i) => {
                const k = dayKey(d);
                const f = fileCounts?.get(k) ?? 0;
                return (
                  <div key={k} className="border-l border-line p-1 space-y-1 min-h-[34px]" style={{ background: tone(d, k) }}>
                    {untimed[i].map((p) => {
                      const c = prio(p.priority).color;
                      return (
                        <button key={p.id} onClick={() => onEdit(p)} title={p.title}
                          className={`w-full text-left truncate rounded px-2 py-1 text-[12px] font-medium ${p.done ? "opacity-55 line-through" : ""}`}
                          style={{ borderLeft: `3px solid ${c}`, background: `color-mix(in srgb, ${c} 13%, var(--surface))` }}>{p.title}</button>
                      );
                    })}
                    {f > 0 && <span className="block text-[11px] text-muted px-1">{f} file{f === 1 ? "" : "s"} changed</span>}
                  </div>
                );
              })}
              {wide && <div className="border-l border-line" />}
            </div>
          )}

          {/* hour grid */}
          <div style={{ display: "grid", gridTemplateColumns: cols }}>
            <Gutter hours={hours} align="right" />
            {days.map((d) => {
              const k = dayKey(d);
              const placed = layoutDay(plansByDay.get(k) ?? []);
              const nowMin = now && dayKey(now) === k ? now.getHours() * 60 + now.getMinutes() : null;
              return (
                <div key={k} role="group" aria-label={d.toDateString()} className="relative border-l border-line cursor-cell"
                  style={{ height: HOUR * 24, background: tone(d, k), ...lines, backgroundBlendMode: "normal" }}
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const y = e.nativeEvent.offsetY;
                    const m = Math.min(23 * 60 + 30, Math.floor(y / (HOUR / 2)) * 30);
                    onCreate(k, `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
                  }}>
                  {placed.map(({ plan, top, height, lane, lanes }) => {
                    const c = prio(plan.priority).color;
                    return (
                      <button key={plan.id} onClick={() => onEdit(plan)}
                        aria-label={`${plan.title}, ${fmtMin(toMin(plan.plan_time) ?? 0)}`}
                        className={`absolute text-left overflow-hidden rounded-[4px] px-2 py-1 text-[12px] leading-snug shadow-[0_1px_0_rgba(0,0,0,.03)] hover:brightness-[.97] hover:z-10 transition ${plan.done ? "opacity-55" : ""}`}
                        style={{
                          top: top + 1, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`,
                          borderLeft: `3px solid ${c}`, background: `color-mix(in srgb, ${c} 13%, var(--surface))`
                        }}>
                        <span className="flex items-center gap-1.5 font-medium tabular-nums">
                          {fmtMin(toMin(plan.plan_time) ?? 0)}
                          <span className="size-2.5 rounded-full border-2 shrink-0" style={{ borderColor: c }} />
                        </span>
                        {height >= 44 && <span className={`block ${plan.done ? "line-through" : ""} ${height >= 70 ? "" : "truncate"}`}>{plan.title}</span>}
                      </button>
                    );
                  })}
                  {nowMin !== null && (
                    <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: (nowMin / 60) * HOUR }} aria-hidden="true">
                      <div className="h-[2px] bg-danger" /><span className="absolute -left-1 -top-[3px] size-2 rounded-full bg-danger" />
                    </div>
                  )}
                </div>
              );
            })}
            {wide && <Gutter hours={hours} align="left" />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Gutter({ hours, align }: { hours: number[]; align: "left" | "right" }) {
  return (
    <div className={`relative border-l border-line ${align === "right" ? "border-l-0" : ""}`} style={{ height: HOUR * 24 }} aria-hidden="true">
      {hours.slice(1).map((h) => (
        <span key={h} className={`absolute inset-x-0 px-2 text-[11px] text-muted tabular-nums ${align === "right" ? "text-right" : "text-left"}`}
          style={{ top: h * HOUR - 7 }}>{hourLabel(h)}</span>
      ))}
    </div>
  );
}
