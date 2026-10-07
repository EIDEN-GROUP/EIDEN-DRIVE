"use client";
import { useEffect, useMemo, useState } from "react";
import { X, Download, Pencil, Loader2, FileWarning } from "lucide-react";
import { viewKind, mdToHtml, highlight, escHtml } from "./filetext";

export interface ViewFile { id: string; name: string; mime?: string; size?: number; backends?: string[] }

// In-app preview. Google-hosted bytes stream through ?raw=1 (Drive blocks
// framing); Supabase-hosted files use a short signed URL (?json=1).
// Office binaries (docx/xlsx/…) have no safe renderer here — honest fallback.
export default function FileViewer({ file, onClose, onEdit }: {
  file: ViewFile; onClose: () => void; onEdit: (f: ViewFile) => void;
}) {
  const kind = viewKind(file.name, file.mime);
  const isLive = file.id.startsWith("g:"); // not yet synced: preview streams, no download/edit endpoints
  const rawUrl = `/api/drive/download?file_id=${file.id}&raw=1`;
  const [text, setText] = useState<string | null>(null);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(kind === "markdown" || kind === "html" || kind === "code");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        if (kind === "markdown" || kind === "html" || kind === "code") {
          const r = await fetch(rawUrl);
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error((d as { error?: string }).error ?? `preview failed (${r.status})`);
          }
          const t = await r.text();
          if (!dead) setText(t);
        } else if (kind === "image" || kind === "video" || kind === "audio" || kind === "pdf") {
          if (file.backends?.includes("local")) {
            const r = await fetch(`/api/drive/download?file_id=${file.id}&json=1`);
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error ?? "couldn't load preview");
            if (!dead) setEmbedUrl(d.url);
          } else if (!dead) setEmbedUrl(rawUrl);
        }
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : "Couldn't load preview.");
      } finally {
        if (!dead) setBusy(false);
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const mdHtml = useMemo(() => (kind === "markdown" && text !== null ? mdToHtml(text) : ""), [kind, text]);
  const codeHtml = useMemo(() => {
    if (kind !== "code" || text === null) return "";
    return text.split("\n").map((l) => highlight(l) || "&nbsp;").map((h, i) =>
      `<span class="cl"><span class="ln">${i + 1}</span><span class="lc">${h}</span></span>`).join("");
  }, [kind, text]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="pop-in relative w-full max-w-4xl max-h-[88vh] rounded-xl bg-surface border border-line shadow-pop flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 min-h-[56px] border-b border-line">
          <p className="text-[14px] font-medium truncate flex-1">{file.name}</p>
          {(kind === "markdown" || kind === "html" || kind === "code") && !isLive && (
            <button onClick={() => onEdit(file)} className="min-h-[40px] px-3 rounded-md border border-line text-[13px] flex items-center gap-1.5 hover:bg-tint">
              <Pencil size={14} /> Edit
            </button>
          )}
          {!isLive && (
            <a href={`/api/drive/download?file_id=${file.id}`}
              className="min-h-[40px] px-3 rounded-md border border-line text-[13px] flex items-center gap-1.5 hover:bg-tint">
              <Download size={14} /> Download
            </a>
          )}
          <button onClick={onClose} aria-label="Close preview" className="size-11 grid place-items-center rounded-md hover:bg-tint"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {busy && (
            <div className="p-6 space-y-3" aria-label="Loading preview">
              <div className="skel h-5 w-2/3" /><div className="skel h-4 w-full" /><div className="skel h-4 w-5/6" /><div className="skel h-4 w-4/6" />
            </div>
          )}
          {err && (
            <div className="p-8 text-center">
              <FileWarning size={28} className="mx-auto text-muted" />
              <p className="mt-3 text-[14px]">{err}</p>
              {!isLive && <a href={`/api/drive/download?file_id=${file.id}`} className="mt-4 inline-flex min-h-[44px] items-center px-4 rounded-md bg-brand text-white text-sm">Download instead</a>}
            </div>
          )}
          {!busy && !err && kind === "image" && embedUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={embedUrl} alt={`Preview of ${file.name}`} className="mx-auto max-h-[70vh] object-contain" />
          )}
          {!busy && !err && kind === "video" && embedUrl && (
            <video src={embedUrl} controls className="w-full max-h-[70vh] bg-black" preload="metadata" />
          )}
          {!busy && !err && kind === "audio" && embedUrl && (
            <div className="p-8"><audio src={embedUrl} controls className="w-full" preload="metadata" /></div>
          )}
          {!busy && !err && kind === "pdf" && embedUrl && (
            <iframe src={embedUrl} title={`PDF preview of ${file.name}`} className="w-full h-[70vh] border-0" />
          )}
          {!busy && !err && kind === "markdown" && text !== null && (
            <article className="md-body p-5 sm:p-7 max-w-none" dangerouslySetInnerHTML={{ __html: mdHtml }} />
          )}
          {!busy && !err && kind === "html" && text !== null && (
            <iframe srcDoc={text} sandbox="" title={`HTML preview of ${file.name}`} className="w-full h-[70vh] border-0 bg-white" />
          )}
          {!busy && !err && kind === "code" && text !== null && (
            <pre className="code-view p-4 text-[12.5px] leading-6" dangerouslySetInnerHTML={{ __html: codeHtml || escHtml(" ") }} />
          )}
          {!busy && !err && (kind === "office" || kind === "unknown") && (
            <div className="p-8 text-center">
              <FileWarning size={28} className="mx-auto text-muted" />
              <p className="mt-3 text-[14px]">No in-app preview for this format — the bytes stay untouched.</p>
              {!isLive && <a href={`/api/drive/download?file_id=${file.id}`} className="mt-4 inline-flex min-h-[44px] items-center px-4 rounded-md bg-brand text-white text-sm">Download to view</a>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
