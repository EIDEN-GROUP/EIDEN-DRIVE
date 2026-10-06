"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

export default function FileActions({ id, name, googleId, downloadable }: {
  id: string; name: string; googleId?: string | null; downloadable: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function trash() {
    setBusy(true);
    const r = await fetch("/api/drive/trash", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: id })
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setConfirm(false);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't move to Bin.", tone: "err" }); return; }
    toast({ text: `"${name}" moved to Recovery Bin.`, tone: "ok" });
    router.push("/drive");
  }

  return (
    <>
      <div className="mt-3 flex gap-2 flex-wrap">
        {downloadable && (
          <a href={`/api/drive/download?file_id=${id}`}
            className="min-h-[44px] px-4 inline-flex items-center rounded-md bg-brand text-white text-sm font-medium">
            Download
          </a>
        )}
        {googleId && (
          <a href={`https://drive.google.com/file/d/${googleId}/view`} target="_blank" rel="noreferrer"
            className="min-h-[44px] px-4 inline-flex items-center rounded-md border border-line text-sm">
            Open in Google Drive
          </a>
        )}
        <button onClick={() => setConfirm(true)}
          className="min-h-[44px] px-4 rounded-md border border-danger/40 text-danger text-sm">
          Move to Recovery Bin
        </button>
      </div>
      <ConfirmDialog open={confirm} title="Move to Recovery Bin?"
        body={`"${name}" stays recoverable for 90 days. Members can never delete permanently.`}
        confirmLabel={busy ? "Moving…" : "Move to Bin"}
        onClose={() => !busy && setConfirm(false)} onConfirm={trash} />
    </>
  );
}
