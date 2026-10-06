"use client";
import { useEffect, useState } from "react";
import { X, BellOff, CheckCheck, AlertTriangle, Info, ShieldCheck, CloudDownload } from "lucide-react";

export interface Notice { id: string; kind: string; title: string; body: string | null; read: boolean; created_at: string }

function icon(kind: string) {
  if (kind === "error" || kind === "sync-error") return <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />;
  if (kind === "approval") return <ShieldCheck size={16} className="text-brand shrink-0 mt-0.5" />;
  if (kind === "sync") return <CloudDownload size={16} className="text-brand shrink-0 mt-0.5" />;
  return <Info size={16} className="text-muted shrink-0 mt-0.5" />;
}

function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Right-side drawer feed: sync errors, approvals, Coffee-grade everything-else.
// Bell badge count comes from the same endpoint (unread).
export default function NotificationsPanel({ open, onClose, onSeen }: {
  open: boolean; onClose: () => void; onSeen: () => void;
}) {
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    (async () => {
      setLoading(true);
      const r = await fetch("/api/notifications");
      const d = await r.json().catch(() => ({}));
      if (!dead) {
        setItems(d.results ?? []);
        setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [open ]);

  async function markAll() {
    await fetch("/api/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true }) });
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    onSeen();
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Notifications">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="pop-in absolute right-0 inset-y-0 w-[min(360px,92vw)] bg-surface border-l border-line shadow-pop flex flex-col">
        <div className="flex items-center gap-2 px-4 min-h-[60px] border-b border-line">
          <h2 className="text-[15px] font-medium flex-1">Notifications</h2>
          {items.some((n) => !n.read) && (
            <button onClick={markAll} className="min-h-[40px] px-2 text-[12px] text-brand font-medium flex items-center gap-1 hover:underline">
              <CheckCheck size={14} /> Mark all read
            </button>
          )}
          <button onClick={onClose} aria-label="Close notifications" className="size-11 grid place-items-center rounded-md hover:bg-tint"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="p-4 space-y-3" aria-label="Loading notifications">
              <div className="skel h-12 w-full" /><div className="skel h-12 w-full" /><div className="skel h-12 w-full" />
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="p-8 text-center text-muted">
              <BellOff size={28} className="mx-auto opacity-50" />
              <p className="mt-3 text-[14px]">All quiet — sync errors, approvals and alerts land here.</p>
            </div>
          )}
          {items.map((n) => (
            <div key={n.id} className={`px-4 py-3 border-b border-line/70 flex gap-2.5 ${n.read ? "opacity-70" : ""}`}>
              {icon(n.kind)}
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium leading-snug">{n.title}</p>
                {n.body && <p className="text-[12.5px] text-muted mt-0.5 leading-snug break-words">{n.body}</p>}
                <p className="text-[11px] text-muted mt-1">{ago(n.created_at)}</p>
              </div>
              {!n.read && <span className="size-2 rounded-full bg-brand mt-1.5 shrink-0" aria-label="Unread" />}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
