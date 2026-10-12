"use client";
import { useEffect, useRef } from "react";
import Modal from "./Modal";
import { Ring } from "./Loaders";

export default function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", busy = false, busyLabel, onConfirm, onClose }: {
  open: boolean; title: string; body: string; confirmLabel?: string;
  busy?: boolean; busyLabel?: string;
  onConfirm: () => void; onClose: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  // Focus the SAFE action: Enter must never instantly destroy. The destructive
  // button stays one deliberate Tab away.
  useEffect(() => { if (open && !busy) btnRef.current?.focus(); }, [open, busy]);
  return (
    <Modal open={open} title={title} onClose={busy ? () => {} : onClose} width={400} labelId="cf-title">
      <p className="text-sm text-muted leading-relaxed break-words">{body}</p>
      <div className="mt-5 flex justify-end gap-2 flex-wrap">
        <button ref={btnRef} onClick={onClose} disabled={busy} className="min-h-[40px] px-4 rounded-md border border-line text-sm hover:bg-tint disabled:opacity-50">Cancel</button>
        <button onClick={onConfirm} disabled={busy} className="min-h-[40px] px-4 rounded-md bg-danger text-white text-sm font-medium max-w-full break-words disabled:opacity-70 inline-flex items-center gap-2">
          {busy && <Ring className="size-4" />}
          {busy ? (busyLabel ?? "Working…") : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
