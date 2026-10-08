"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Dialog chrome from the reference: title row, close ×, blurred backdrop. */
export default function Modal({ open, title, onClose, children, width = 440, labelId = "modal-title" }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; width?: number; labelId?: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Stable onClose: parents pass inline arrows (new identity every keystroke) —
  // the open-effect must NOT re-run because of that, or focus gets stolen while typing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    // Focus the form's first field once, on open — never again while typing.
    // (React handles autoFocus without leaving an [autofocus] attribute behind,
    // so query the field directly instead of the attribute.)
    const field = boxRef.current?.querySelector<HTMLElement>(
      "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])"
    );
    (field ?? closeRef.current)?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/30 backdrop-blur-[3px] p-4" onClick={onClose}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={labelId} style={{ maxWidth: width }}
        className="pop-in w-full rounded-xl bg-surface shadow-pop border border-line" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-line">
          <h2 id={labelId} className="text-[15px] font-medium">{title}</h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="size-11 grid place-items-center rounded-md hover:bg-tint"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
