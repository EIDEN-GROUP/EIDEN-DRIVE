import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Dashboard building blocks (pure presentation — safe in server and client components).

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-[28px] leading-tight font-medium tracking-tight">{title}</h1>
        {subtitle && <p className="text-[14px] text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, subtitle, actions, children, className = "" }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-5 sm:p-6 min-w-0 ${className}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[20px] sm:text-[22px] font-medium leading-tight">{title}</h2>
          {subtitle && <p className="text-[13.5px] text-muted mt-1">{subtitle}</p>}
        </div>
        {actions}
      </header>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-3 min-[1380px]:grid-cols-6 gap-3 sm:gap-4 mb-5">{children}</div>;
}

const TONE: Record<string, string> = { default: "", good: "text-[#15902a]", warn: "text-[#b45309]", bad: "text-danger", brand: "text-brand" };
export function Kpi({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" | "bad" | "brand" }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-5 min-w-0">
      <p className="text-[13.5px] text-muted truncate">{label}</p>
      <p className={`mt-5 text-[34px] leading-none font-medium tabular-nums truncate ${TONE[tone]}`}>{value}</p>
      {hint !== undefined && <p className="mt-2 text-[12px] text-muted truncate">{hint}</p>}
    </div>
  );
}

const PILL: Record<string, { bg: string; fg: string }> = {
  good: { bg: "#22c32e", fg: "#15902a" }, warn: { bg: "#f59e0b", fg: "#b45309" }, bad: { bg: "#e5322d", fg: "#c4271f" },
  info: { bg: "#2563eb", fg: "#1d4ed8" }, neutral: { bg: "#64748b", fg: "#475569" }, brand: { bg: "#533faf", fg: "#533faf" }
};
export function StatusPill({ tone = "neutral", children, color }: { tone?: keyof typeof PILL; children: ReactNode; color?: string }) {
  const c = color ? { bg: color, fg: `color-mix(in srgb, ${color} 75%, var(--ink))` } : PILL[tone];
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[12.5px] whitespace-nowrap"
      style={{ background: `color-mix(in srgb, ${c.bg} 12%, var(--surface))`, border: `1px solid color-mix(in srgb, ${c.bg} 35%, transparent)`, color: c.fg }}>
      <span className="size-1.5 rounded-full" style={{ background: c.bg }} />{children}
    </span>
  );
}

export function IconBadge({ Icon, color, size = 44 }: { Icon: LucideIcon; color: string; size?: number }) {
  return (
    <span className="grid place-items-center rounded-full shrink-0" aria-hidden="true"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 14%, var(--surface))`, color }}>
      <Icon size={Math.round(size * 0.44)} strokeWidth={2} />
    </span>
  );
}

export function FeedItem({ Icon, color, children, time }: { Icon: LucideIcon; color: string; children: ReactNode; time: string }) {
  return (
    <li className="flex items-start gap-3.5 py-3">
      <IconBadge Icon={Icon} color={color} />
      <div className="min-w-0 pt-0.5">
        <p className="text-[15px] leading-snug">{children}</p>
        <p className="text-[12.5px] text-muted mt-0.5">{time}</p>
      </div>
    </li>
  );
}

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24); if (d < 8) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-[14px] text-muted">{children}</p>;
}

// ── Smooth multi-series line chart (SVG, no JS). Native tooltips via <title>. ──
export interface Series { name: string; color: string; values: number[] }
// Axis max chosen so the 4 gridline steps are whole, "round" numbers (1, 2, 2.5→3, 5 × 10^k).
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 3, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
  return step * 4;
}
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    d += ` C${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]},${p2[1]}`;
  }
  return d;
}
export function LineChart({ labels, series, yLabel, empty = "No data in this window yet." }: { labels: string[]; series: Series[]; yLabel?: string; empty?: string }) {
  const W = 760, H = 300, L = 46, R = 18, T = 14, B = 36;
  const n = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  if (n < 2 || max === 0 || series.every((s) => s.values.every((v) => v === 0))) return <EmptyNote>{empty}</EmptyNote>;
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const step = Math.ceil(n / 8);
  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mb-2">
        {series.map((s) => <span key={s.name} className="inline-flex items-center gap-2 text-[14px]"><span className="size-3.5 rounded-[3px]" style={{ background: s.color }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Line chart: ${series.map((s) => s.name).join(", ")}`}>
        <defs>{series.map((s, i) => (
          <linearGradient key={i} id={`area-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity=".16" /><stop offset="1" stopColor={s.color} stopOpacity="0" /></linearGradient>
        ))}</defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={i === 0 ? undefined : "3 5"} />
            <text x={L - 10} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{Number.isInteger(t) ? t : t.toFixed(1)}</text>
          </g>
        ))}
        {labels.map((l, i) => i % step === 0 || i === n - 1 ? (
          <g key={i}><line x1={x(i)} x2={x(i)} y1={H - B} y2={H - B + 5} stroke="var(--line)" /><text x={x(i)} y={H - B + 20} textAnchor="middle" fontSize="12" fill="var(--muted)">{l}</text></g>
        ) : null)}
        {yLabel && <text transform={`translate(12 ${(H - B + T) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="var(--muted)">{yLabel}</text>}
        {series[0] && <path d={`${smooth(series[0].values.map((v, i) => [x(i), y(v)]))} L${x(n - 1)},${H - B} L${x(0)},${H - B} Z`} fill="url(#area-0)" />}
        {series.map((s, si) => (
          <g key={si}>
            <path d={smooth(s.values.map((v, i) => [x(i), y(v)]))} fill="none" stroke={s.color} strokeWidth="2.4" strokeLinecap="round" />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="4.2" fill={s.color} stroke="var(--surface)" strokeWidth="1.5"><title>{`${labels[i]} · ${s.name}: ${v}`}</title></circle>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
