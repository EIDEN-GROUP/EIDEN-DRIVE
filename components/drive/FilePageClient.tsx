"use client";
import { useEffect, useState } from "react";
import { Eye, Pencil, Share2, Link2, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import FileViewer, { type ViewFile } from "./FileViewer";
import FileEditor from "./FileEditor";
import { editable } from "./filetext";

interface Link { id: string; created_at: string; expires_at: string; expired: boolean }

// Preview + edit + share actions for the file page.
export default function FilePageClient({ file }: { file: { id: string; name: string; mime: string; size: number; backends: string[]; google_file_id: string | null } }) {
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [links, setLinks] = useState<Link[]>([]);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const vf: ViewFile = { id: file.id, name: file.name, mime: file.mime, size: file.size, backends: file.backends, googleId: file.google_file_id };
  const canEdit = editable(file.name, file.mime);

  async function reload() {
    const r = await fetch(`/api/share?file_id=${file.id}`);
    const d = await r.json().catch(() => ({}));
    if (r.ok) setLinks(d.results ?? []);
  }
  useEffect(() => { reload(); }, [file.id]);

  async function create(days: number) {
    setBusy(true);
    const r = await fetch("/api/share", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: file.id, days })
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't create the link.", tone: "err" }); return; }
    setFreshUrl(d.url);
    reload();
  }

  async function revoke(id: string) {
    const r = await fetch("/api/share", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (!r.ok) { toast({ text: "Couldn't revoke.", tone: "err" }); return; }
    toast({ text: "Link revoked — the URL dies instantly.", tone: "ok" });
    reload();
  }

  function copy(t: string) {
    navigator.clipboard?.writeText(t).then(
      () => toast({ text: "Link copied.", tone: "ok" }),
      () => toast({ text: "Couldn't copy — select it manually.", tone: "err" })
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setViewOpen(true)}
          className="min-h-[44px] px-4 inline-flex items-center gap-1.5 rounded-md bg-brand text-white text-sm font-medium">
          <Eye size={15} /> Preview
        </button>
        {canEdit && (
          <button onClick={() => setEditOpen(true)}
            className="min-h-[44px] px-4 inline-flex items-center gap-1.5 rounded-md border border-line text-sm hover:bg-tint">
            <Pencil size={15} /> Edit
          </button>
        )}
      </div>

      <div className="rounded-xl border border-line p-4">
        <p className="text-[13px] font-medium flex items-center gap-1.5"><Share2 size={14} /> Share link</p>
        <p className="text-[12px] text-muted mt-1">Preview-only page with rich link unfurls. Never editable, expires automatically.</p>
        {freshUrl && (
          <div className="mt-3 p-3 rounded-lg bg-tint">
            <p className="text-[12px] font-medium text-brand">Copy it now — shown once:</p>
            <p className="mt-1 text-[12.5px] break-all font-mono">{freshUrl}</p>
            <button onClick={() => copy(freshUrl)} className="mt-2 min-h-[40px] px-3 rounded-md bg-surface border border-line text-[13px] inline-flex items-center gap-1.5 hover:bg-tint">
              {navigator.clipboard ? <><Link2 size={14} /> Copy link</> : "Select & copy"}
            </button>
          </div>
        )}
        <div className="mt-3 flex gap-2 flex-wrap">
          {[7, 30].map((d) => (
            <button key={d} onClick={() => create(d)} disabled={busy}
              className="min-h-[40px] px-3 rounded-md border border-line text-[13px] hover:bg-tint disabled:opacity-50">
              {busy ? "…" : `New ${d}-day link`}
            </button>
          ))}
        </div>
        {links.length > 0 && (
          <ul className="mt-3 text-[12.5px]">
            {links.map((l) => (
              <li key={l.id} className="py-2 border-t border-line/60 flex items-center gap-2">
                <span className="flex-1 text-muted">
                  created {new Date(l.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  {" · "}{l.expired ? <span className="text-danger">expired</span> : `expires ${new Date(l.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                </span>
                {!l.expired && (
                  <button onClick={() => revoke(l.id)} aria-label="Revoke link"
                    className="size-9 grid place-items-center rounded-md text-muted hover:text-danger hover:bg-danger/10">
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewOpen && <FileViewer file={vf} onClose={() => setViewOpen(false)} onEdit={(f) => { setViewOpen(false); setEditOpen(true); }} />}
      {editOpen && <FileEditor file={vf} onClose={() => setEditOpen(false)} onSaved={() => window.location.reload()} />}
    </div>
  );
}
