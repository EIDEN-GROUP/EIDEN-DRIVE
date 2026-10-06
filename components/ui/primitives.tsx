import type { ReactNode } from "react";

export function Card({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="card p-5">
      {label && <h2 className="text-[13px] font-semibold text-ink">{label}</h2>}
      <div className={label ? "mt-3" : ""}>{children}</div>
    </div>
  );
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "gold" | "fill" | "green" | "red" }) {
  const tones: Record<string, string> = {
    default: "bg-tint text-brand",
    gold: "bg-tint text-brand",
    fill: "bg-brand text-white",
    green: "bg-[#22c32e]/15 text-[#15902a]",
    red: "bg-danger/10 text-danger"
  };
  return <span className={`pill inline-block px-2.5 py-1 ${tones[tone]}`}>{children}</span>;
}

export function StorageBar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const tone = pct >= 95 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-brand";
  return (
    <div>
      <div className="flex justify-between text-xs text-muted"><span>{label}</span><span>{pct}%</span></div>
      <div className="mt-1 h-2 rounded-full bg-tint overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full ${tone} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
