import type { ReactNode } from "react";

export function Card({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="card p-4 bg-white shadow-sm">
      {label && <h2 className="text-xs font-bold tracking-[.18em] uppercase text-[var(--e-green-800)]">{label}</h2>}
      <div className={label ? "mt-2" : ""}>{children}</div>
    </div>
  );
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "gold" | "fill" | "green" | "red" }) {
  const tones: Record<string, string> = {
    default: "border border-[var(--e-line-strong)]",
    gold: "bg-gold-500 text-[var(--e-green-900)] border border-gold-500",
    fill: "bg-teal-600 text-cream-50 border border-teal-600",
    green: "bg-green-50 text-green-800 border border-green-200",
    red: "bg-red-50 text-red-700 border border-red-200"
  };
  return <span className={`pill inline-block px-3 py-1 ${tones[tone]}`}>{children}</span>;
}

export function StorageBar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const tone = pct >= 95 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-teal-600";
  return (
    <div>
      <div className="flex justify-between text-xs"><span>{label}</span><span>{pct}%</span></div>
      <div className="h-2 rounded-full bg-black/10 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full ${tone} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
