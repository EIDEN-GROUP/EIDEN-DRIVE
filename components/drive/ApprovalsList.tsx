"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "../ui/Toast";

export interface Approval { id: string; file: string; requester: string; created: string }

export default function ApprovalsList({ items }: { items: Approval[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(approval_id: string, decision: "approved" | "denied") {
    setBusy(approval_id);
    const r = await fetch("/api/approvals", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ approval_id, decision })
    });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't record decision.", tone: "err" }); return; }
    toast({ text: decision === "denied" ? "Delete rejected — file restored." : "Delete acknowledged.", tone: "ok" });
    router.refresh();
  }

  if (items.length === 0) return <p className="text-sm text-muted">No pending approvals.</p>;
  return (
    <ul className="text-sm divide-y divide-line/70">
      {items.map((a) => (
        <li key={a.id} className="py-2 flex items-center gap-2">
          <span className="flex-1 min-w-0 truncate">{a.file} <span className="text-muted">· {a.requester}</span></span>
          <button disabled={!!busy} onClick={() => decide(a.id, "approved")} className="min-h-[44px] px-3 rounded-md bg-brand text-white text-[13px] disabled:opacity-50">Approve</button>
          <button disabled={!!busy} onClick={() => decide(a.id, "denied")} className="min-h-[44px] px-3 rounded-md border border-danger/40 text-danger text-[13px] disabled:opacity-50">Deny</button>
        </li>
      ))}
    </ul>
  );
}
