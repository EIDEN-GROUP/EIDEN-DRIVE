"use client";
import MiniMonth from "./MiniMonth";

/** Quarter (3 months) and Year (12 months) overview built from compact month cards. */
export default function MultiMonth({ months, selected, today, counts, onPickDay, onPickMonth }: {
  months: Date[]; selected: Date; today: Date; counts: Map<string, number>;
  onPickDay: (d: Date) => void; onPickMonth: (d: Date) => void;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className={`grid gap-4 ${months.length > 3 ? "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" : "md:grid-cols-3"}`}>
        {months.map((m) => (
          <section key={m.getMonth() + "-" + m.getFullYear()} className="rounded-2xl border border-line bg-surface p-4">
            <button onClick={() => onPickMonth(m)} className="text-[16px] font-medium hover:text-brand mb-2 text-left">
              {m.toLocaleDateString("en-GB", { month: "long" })}
            </button>
            <MiniMonth month={m} selected={selected} today={today} counts={counts} onPick={onPickDay} dim />
          </section>
        ))}
      </div>
    </div>
  );
}
