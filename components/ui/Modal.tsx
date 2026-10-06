"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Dialog chrome from the reference: title row, close ×, blurred backdrop. */
export default function Modal({ open, title, onClose, children, width = 440, labelId = "modal-title" }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; width?: number; labelId?: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/30 backdrop-blur-[3px] p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={labelId} style={{ maxWidth: width }}
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
