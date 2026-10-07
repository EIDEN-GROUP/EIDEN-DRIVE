import type { PlanRow } from "@/app/api/plans/route";

export type Plan = PlanRow;
export type View = "day" | "week" | "month" | "quarter" | "year";
export const HOUR = 64;            // px per hour in the time grid
export const DEFAULT_MIN = 60;     // plans have no end time → shown as 1 h
export const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
export const WEEKDAYS_LONG = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Priority → colour (matches the reference: blue / pink / orange). Mixed with the surface so dark mode works. */
export const PRIORITY = {
  low: { label: "Low", color: "#f59a3b" },
  normal: { label: "Normal", color: "#4f6bed" },
  high: { label: "High", color: "#e5489b" }
} as const;
export type Priority = keyof typeof PRIORITY;
export const prio = (p: string) => PRIORITY[(p as Priority) in PRIORITY ? (p as Priority) : "normal"];

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseKey = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfWeek = (d: Date) => addDays(d, -d.getDay()); // Sunday-first like the reference
export const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

export function toMin(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}
export function fmtMin(min: number, withMeridiem = true): string {
  const h24 = Math.floor(min / 60) % 24, m = min % 60;
  const h = h24 % 12 || 12;
  const mm = m ? `:${String(m).padStart(2, "0")}` : ":00";
  return withMeridiem ? `${h}${mm} ${h24 >= 12 ? "PM" : "AM"}` : `${h}${mm}`;
}
export function fmtRange(t: string | null | undefined): string {
  const s = toMin(t);
  if (s === null) return "All day";
  const e = Math.min(s + DEFAULT_MIN, 24 * 60);
  const sm = s >= 12 * 60, em = e >= 12 * 60 && e < 24 * 60;
  return `${fmtMin(s, sm !== em)} – ${fmtMin(e)}`;
}
export function hourLabel(h: number): string { return `${h % 12 || 12} ${h >= 12 && h < 24 ? "PM" : "AM"}`; }
export function gmtLabel(): string {
  const off = -new Date().getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `GMT ${sign}${Math.floor(a / 60)}${a % 60 ? ":" + String(a % 60).padStart(2, "0") : ""}`;
}

/** Month grid (always 6 rows, Sunday-first) for the month containing `d`. */
export function monthCells(d: Date): Date[] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export interface Placed { plan: Plan; top: number; height: number; lane: number; lanes: number }
/** Side-by-side layout for overlapping timed plans in one day column. */
export function layoutDay(plans: Plan[]): Placed[] {
  const items = plans
    .map((p) => ({ p, s: toMin(p.plan_time) }))
    .filter((x): x is { p: Plan; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s);
  const out: Placed[] = [];
  let cluster: { p: Plan; s: number; e: number; lane: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) {
      out.push({ plan: c.p, top: (c.s / 60) * HOUR, height: Math.max(28, ((c.e - c.s) / 60) * HOUR - 2), lane: c.lane, lanes });
    }
    cluster = [];
  };
  for (const it of items) {
    const e = Math.min(it.s + DEFAULT_MIN, 24 * 60);
    if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1; }
    const used = new Set(cluster.filter((c) => c.e > it.s).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ p: it.p, s: it.s, e, lane });
    clusterEnd = Math.max(clusterEnd, e);
  }
  if (cluster.length) flush();
  return out;
}
