"use client";
import { useEffect, useRef } from "react";
import Modal from "./Modal";

export default function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", onConfirm, onClose }: {
  open: boolean; title: string; body: string; confirmLabel?: string;
  onConfirm: () => void; onClose: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) btnRef.current?.focus(); }, [open]);
  return (
    <Modal open={open} title={title} onClose={onClose} width={400} labelId="cf-title">
      <p className="text-sm text-muted leading-relaxed break-words">{body}</p>
      <div className="mt-5 flex justify-end gap-2 flex-wrap">
        <button onClick={onClose} className="min-h-[40px] px-4 rounded-md border border-line text-sm hover:bg-tint">Cancel</button>
        <button ref={btnRef} onClick={onConfirm} className="min-h-[40px] px-4 rounded-md bg-danger text-white text-sm font-medium max-w-full break-words">{confirmLabel}</button>
      </div>
    </Modal>
  );
}
