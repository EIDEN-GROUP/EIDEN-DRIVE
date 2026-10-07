"use client";
import { CalendarClock, Check, FolderClosed } from "lucide-react";
import { fmtRange, prio, type Plan } from "./cal";

/** Round coloured badge used in the agenda (reference: filled circle with a white glyph). */
export function PlanBadge({ plan, size = 28 }: { plan: Plan; size?: number }) {
  const c = prio(plan.priority).color;
  return (
    <span className="rounded-full grid place-items-center text-white shrink-0" style={{ width: size, height: size, background: c }} aria-hidden="true">
      {plan.done ? <Check size={size * 0.5} strokeWidth={3} /> : plan.folder ? <FolderClosed size={size * 0.5} /> : <CalendarClock size={size * 0.52} />}
    </span>
  );
}

/** One agenda row: badge · time range · title · folder · action button. */
export function AgendaItem({ plan, folder, onOpen, onToggle }: {
  plan: Plan; folder?: string; onOpen: () => void; onToggle: () => void;
}) {
  return (
    <div className={`flex items-start gap-3 py-2.5 ${plan.done ? "opacity-55" : ""}`}>
      <PlanBadge plan={plan} />
      <button onClick={onOpen} className="flex-1 min-w-0 text-left rounded-md focus-visible:outline-offset-4">
        <span className="block text-[12px] text-muted tabular-nums">{fmtRange(plan.plan_time)}</span>
        <span className={`block text-[15px] font-medium leading-snug ${plan.done ? "line-through" : ""}`}>{plan.title}</span>
        {(folder || plan.detail) && <span className="block text-[13px] text-muted truncate">{folder ? `@ ${folder}` : plan.detail}</span>}
      </button>
      <button onClick={onToggle} aria-label={plan.done ? `Reopen ${plan.title}` : `Mark ${plan.title} done`}
        className="shrink-0 min-h-[40px] px-4 rounded-lg border border-line bg-surface text-[13.5px] font-medium hover:bg-tint transition-colors">
        {plan.done ? "Undo" : "Done"}
      </button>
    </div>
  );
}
