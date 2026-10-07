"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; hidden?: boolean }

interface Pos { top?: number; bottom?: number; left?: number; right?: number }

/** Popover menu. The panel is rendered in a portal on <body> (position: fixed next to its button), so it can never be
 *  clipped by a scrolling pane or painted underneath neighbouring rows. Flips upward near the bottom of the screen.
 *  Closes on outside click, Escape, scroll or resize. */
export default function Menu({ trigger, items, label, align = "right", active, triggerClassName, rootClassName = "" }: {
  trigger: ReactNode; items: (MenuItem | "sep")[]; label: string; align?: "left" | "right"; active?: string; triggerClassName?: string; rootClassName?: string;
}) {
  const [pos, setPos] = useState<Pos | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  function toggle() {
    if (open) { setPos(null); return; }
    const r = btn.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 260 && r.top > below;
    setPos({
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      ...(align === "right" ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) })
    });
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const down = (e: MouseEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !panel.current?.contains(t)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); btn.current?.focus(); } };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    window.addEventListener("resize", close); window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [open]);

  return (
    <div className={`relative ${rootClassName}`}>
      <button ref={btn} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={label}
        className={triggerClassName ?? "min-h-[44px] px-1.5 rounded-md grid place-items-center hover:bg-tint transition-colors"}>{trigger}</button>
      {open && createPortal(
        <div ref={panel} role="menu" aria-label={label} style={pos!}
          className="pop-in fixed z-[90] w-max min-w-[188px] max-w-[320px] py-1.5 rounded-lg bg-surface border border-line shadow-pop">
          {items.map((it, i) => it === "sep" ? <div key={i} className="my-1 border-t border-line" /> : it.hidden ? null : (
            <button key={it.label} role="menuitem" onClick={() => { setPos(null); it.onSelect(); }}
              className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px] text-left hover:bg-tint ${it.danger ? "text-danger" : "text-ink"} ${active === it.label ? "text-brand font-medium" : ""}`}>
              <span>{it.label}</span>{it.icon && <span className="text-muted">{it.icon}</span>}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
