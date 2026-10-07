"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "../ui/Toast";
import { EmptyNote, IconBadge, StatusPill, relTime } from "../dash/Dash";

export interface Approval { id: string; file: string; requester: string; created: string }

// Pending delete requests: file moved to the Recovery Bin by someone, waiting for a second pair of eyes.
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

  if (items.length === 0) return <EmptyNote>Nothing waiting — no pending approvals.</EmptyNote>;
  return (
    <ul className="divide-y divide-line/70 -my-2" aria-label="Pending delete approvals">
      {items.map((a) => (
        <li key={a.id} className="py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <IconBadge Icon={Trash2} color="#f59e0b" />
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-[15px] font-medium truncate">{a.file}</p>
            <p className="text-[12.5px] text-muted truncate">Requested by {a.requester} · {relTime(a.created)}</p>
          </div>
          <StatusPill tone="warn">Pending</StatusPill>
          <div className="flex gap-2">
            <button disabled={!!busy} onClick={() => decide(a.id, "approved")} className="min-h-[40px] px-4 rounded-lg bg-brand text-white text-[13.5px] font-medium hover:brightness-110 disabled:opacity-50 transition">Approve</button>
            <button disabled={!!busy} onClick={() => decide(a.id, "denied")} className="min-h-[40px] px-4 rounded-lg border border-danger/40 text-danger text-[13.5px] hover:bg-danger/5 disabled:opacity-50 transition">Deny &amp; restore</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
