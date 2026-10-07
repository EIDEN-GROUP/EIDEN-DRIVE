"use client";
import { WEEKDAYS, dayKey, monthCells, sameDay, startOfWeek } from "./cal";

/** Month picker. `big` = the left-panel calendar (week-row highlight, 40 px cells); otherwise compact (quarter/year). */
export default function MiniMonth({ month, selected, today, counts, onPick, big = false, dim = false }: {
  month: Date; selected: Date; today: Date; counts: Map<string, number>;
  onPick: (d: Date) => void; big?: boolean; dim?: boolean;
}) {
  const cells = monthCells(month);
  const weekStart = dayKey(startOfWeek(selected));
  const weeks = Array.from({ length: 6 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const cell = big ? "size-10 text-[14px]" : "size-7 text-[11.5px]";
  return (
    <div role="grid" aria-label={month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}>
      <div role="row" className={`grid grid-cols-7 text-center text-muted ${big ? "text-[13px] mb-2" : "text-[10px] mb-1"}`}>
        {WEEKDAYS.map((w) => <span key={w} role="columnheader" className="py-1">{w}</span>)}
      </div>
      {weeks.map((wk, i) => {
        if (i === 5 && wk.every((d) => d.getMonth() !== month.getMonth())) return null; // drop an all-outside 6th row
        const isSelWeek = big && dayKey(wk[0]) === weekStart;
        return (
          <div key={i} role="row" className={`grid grid-cols-7 place-items-center ${isSelWeek ? "bg-surface rounded-xl shadow-[0_1px_3px_rgba(40,30,90,.08)]" : ""} ${big ? "py-0.5" : ""}`}>
            {wk.map((d) => {
              const k = dayKey(d);
              const inMonth = d.getMonth() === month.getMonth();
              const isToday = sameDay(d, today), isSel = sameDay(d, selected);
              const n = counts.get(k) ?? 0;
              return (
                <button key={k} role="gridcell" onClick={() => onPick(d)} aria-selected={isSel} aria-current={isToday ? "date" : undefined}
                  aria-label={`${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${n ? `, ${n} plan${n === 1 ? "" : "s"}` : ""}`}
                  className={`${cell} relative rounded-full grid place-items-center transition-colors
                    ${!inMonth ? (dim ? "opacity-0 pointer-events-none" : "text-muted/40") : ""}
                    ${isSel ? "ring-1 ring-brand text-brand font-medium" : "hover:bg-tint"}
                    ${isToday && !isSel ? "bg-brand text-white hover:bg-brand font-medium" : ""}
                    ${isToday && isSel ? "bg-brand/10" : ""}`}>
                  {d.getDate()}
                  {n > 0 && inMonth && <span className={`absolute ${big ? "bottom-1" : "bottom-0.5"} size-1 rounded-full ${isToday && !isSel ? "bg-white" : "bg-brand"}`} />}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
