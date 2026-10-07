"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface Option { value: string; label: string; hint?: string; icon?: ReactNode }

/** Styled single-select (replaces the raw browser <select>). Keyboard: ↑ ↓ Home End Enter Esc, type-ahead. */
export default function Select({ value, options, onChange, label, placeholder = "Select…", className = "", disabled }: {
  value: string; options: Option[]; onChange: (v: string) => void; label: string; placeholder?: string; className?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  const sel = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const d = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", d);
    return () => document.removeEventListener("mousedown", d);
  }, [open]);

  function openList() {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }
  function pick(i: number) { onChange(options[i].value); setOpen(false); }
  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); }
    else if (e.key.length === 1) {
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={label}
        onClick={() => (open ? setOpen(false) : openList())} onKeyDown={onKey}
        className="w-full min-h-[44px] px-3 rounded-md border border-line bg-surface text-[13.5px] flex items-center gap-2 text-left hover:border-brand/50 focus:border-brand focus:outline-none disabled:opacity-50 transition-colors">
        {sel?.icon}
        <span className={`flex-1 truncate ${sel ? "" : "text-muted"}`}>{sel?.label ?? placeholder}</span>
        <ChevronDown size={15} className={`text-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul id={listId} role="listbox" aria-label={label}
          className="pop-in absolute z-50 mt-1.5 w-full min-w-[160px] max-h-64 overflow-auto py-1.5 rounded-lg bg-surface border border-line shadow-pop">
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}
              className={`px-3 py-2 text-[13.5px] flex items-center gap-2 cursor-pointer ${i === active ? "bg-tint" : ""} ${o.value === value ? "text-brand font-medium" : ""}`}>
              {o.icon}
              <span className="flex-1 min-w-0"><span className="block truncate">{o.label}</span>{o.hint && <span className="block text-[11px] text-muted truncate">{o.hint}</span>}</span>
              {o.value === value && <Check size={14} className="shrink-0" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
