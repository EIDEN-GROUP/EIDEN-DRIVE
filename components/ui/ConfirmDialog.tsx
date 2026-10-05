"use client";
import { useEffect, useRef } from "react";
import { AlertIcon } from "./icons";

export default function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", onConfirm, onClose }: {
  open: boolean; title: string; body: string; confirmLabel?: string;
  onConfirm: () => void; onClose: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) btnRef.current?.focus(); }, [open ]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cf-title" aria-describedby="cf-body"
        className="card bg-white p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-red-700"><AlertIcon /><h2 id="cf-title" className="font-bold">{title}</h2></div>
        <p id="cf-body" className="text-sm mt-2">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="min-h-[44px] px-4 rounded-2xl border">Cancel</button>
          <button ref={btnRef} onClick={onConfirm} className="min-h-[44px] px-4 rounded-2xl bg-red-700 text-white">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
