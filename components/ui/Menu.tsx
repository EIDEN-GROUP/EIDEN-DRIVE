"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; hidden?: boolean }

/** Small popover menu (toolbar “…” / sort). Closes on outside click or Escape. */
export default function Menu({ trigger, items, label, align = "right", active }: {
  trigger: ReactNode; items: (MenuItem | "sep")[]; label: string; align?: "left" | "right"; active?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const d = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", d); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", d); document.removeEventListener("keydown", k); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={label}
        className="min-h-[36px] px-1.5 rounded-md grid place-items-center hover:bg-tint transition-colors">{trigger}</button>
      {open && (
        <div role="menu" className={`pop-in absolute z-50 mt-1.5 min-w-[188px] py-1.5 rounded-lg bg-surface border border-line shadow-pop ${align === "right" ? "right-0" : "left-0"}`}>
          {items.map((it, i) => it === "sep" ? <div key={i} className="my-1 border-t border-line" /> : it.hidden ? null : (
            <button key={it.label} role="menuitem" onClick={() => { setOpen(false); it.onSelect(); }}
              className={`w-full flex items-center justify-between gap-3 px-3.5 py-2 text-[13px] text-left hover:bg-tint ${it.danger ? "text-danger" : "text-ink"} ${active === it.label ? "text-brand font-medium" : ""}`}>
              <span>{it.label}</span>{it.icon && <span className="text-muted">{it.icon}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
