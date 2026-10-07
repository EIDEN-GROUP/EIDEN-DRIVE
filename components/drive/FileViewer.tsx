"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { X, Download, Pencil, FileWarning, ExternalLink } from "lucide-react";
import { viewKind, editable, type ViewKind } from "./filetext";
import VideoPlayer from "./VideoPlayer";
import { useBytes } from "../viewer/useBytes";
import { decodeText, fmtBytes, looksLikeText, rtfToText, sniff } from "../viewer/lib";
import TextView from "../viewer/TextView";

const Loading = () => <div className="p-6 space-y-3" aria-label="Loading viewer"><div className="skel h-5 w-1/2" /><div className="skel h-4 w-full" /><div className="skel h-4 w-5/6" /></div>;
const lazy = <P extends object>(load: () => Promise<{ default: React.ComponentType<P> }>) => dynamic(load, { ssr: false, loading: Loading });
const MarkdownView = lazy(() => import("../viewer/MarkdownView"));
const CsvView = lazy(() => import("../viewer/CsvView"));
const JsonView = lazy(() => import("../viewer/JsonView"));
const NotebookView = lazy(() => import("../viewer/NotebookView"));
const DocxView = lazy(() => import("../viewer/DocxView"));
const SheetView = lazy(() => import("../viewer/SheetView"));
const SlidesView = lazy(() => import("../viewer/SlidesView"));
const OdfView = lazy(() => import("../viewer/OdfView"));
const EbookView = lazy(() => import("../viewer/EbookView"));
const ArchiveView = lazy(() => import("../viewer/ArchiveView"));
const PdfView = lazy(() => import("../viewer/PdfView"));
const ImageView = lazy(() => import("../viewer/ImageView"));
const FontView = lazy(() => import("../viewer/FontView"));
const BinaryView = lazy(() => import("../viewer/BinaryView"));

export interface ViewFile { id: string; name: string; mime?: string; size?: number; backends?: string[]; googleId?: string | null }

const LABEL: Record<ViewKind, string> = {
  image: "Image", video: "Video", audio: "Audio", pdf: "PDF", markdown: "Markdown", html: "HTML", code: "Text", csv: "Table", json: "JSON", notebook: "Notebook",
  docx: "Word document", sheet: "Spreadsheet", slides: "Presentation", odf: "OpenDocument", archive: "Archive", ebook: "Ebook", font: "Font", rtf: "Rich text",
  legacy: "Legacy Office", office: "Office", unknown: "File"
};
const BYTE_KINDS = new Set<ViewKind>(["markdown", "html", "code", "csv", "json", "notebook", "docx", "sheet", "slides", "odf", "ebook", "archive", "font", "rtf", "legacy", "office", "unknown", "pdf"]);
const TEXT_CAP = 5 * 1024 * 1024;

// In-app reader for every file type we can safely open. Bytes are read through the same-origin raw endpoint,
// rendered in the browser, and never executed. Unknown extensions are identified from the file's own header
// (magic numbers) or, failing that, shown as text / hex — there is no dead end.
export default function FileViewer({ file, onClose, onEdit }: { file: ViewFile; onClose: () => void; onEdit: (f: ViewFile) => void }) {
  const kind0 = viewKind(file.name, file.mime);
  const isLive = file.id.startsWith("g:"); // not yet synced: preview streams, no download/edit endpoints
  const rawUrl = `/api/drive/download?file_id=${encodeURIComponent(file.id)}&raw=1`;
  const needBytes = BYTE_KINDS.has(kind0);
  const { bytes, loading, error, tooLarge } = useBytes(file, needBytes);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [embedErr, setEmbedErr] = useState<string | null>(null);

  // Direct-stream kinds (image / video / audio) and the PDF fallback frame need a URL, not bytes.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        if (kind0 === "image" || kind0 === "video" || kind0 === "audio" || kind0 === "pdf") {
          if (file.backends?.includes("local") && !isLive) {
            const r = await fetch(`/api/drive/download?file_id=${encodeURIComponent(file.id)}&json=1`);
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error ?? "couldn't load preview");
            if (!dead) setEmbedUrl(d.url);
          } else if (!dead) setEmbedUrl(rawUrl);
        }
      } catch (e) { if (!dead) setEmbedErr(e instanceof Error ? e.message : "Couldn't load preview."); }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Effective kind: for unknown files decide from the content itself.
  const sn = useMemo(() => (bytes ? sniff(bytes) : null), [bytes]);
  const eff: ViewKind = useMemo(() => {
    if (kind0 !== "unknown" || !bytes) return kind0;
    if (sn?.kind === "pdf" || sn?.kind === "image" || sn?.kind === "audio" || sn?.kind === "video" || sn?.kind === "font" || sn?.kind === "legacy") return sn.kind;
    if (sn?.kind === "archive") return "archive";
    if (looksLikeText(bytes)) return "code";
    return "unknown";
  }, [kind0, bytes, sn]);
  // Blob URL for media sniffed from bytes (e.g. a photo with no extension).
  const blobUrl = useMemo(() => {
    if (!bytes || kind0 !== "unknown" || !(eff === "image" || eff === "audio" || eff === "video")) return null;
    const t = sn?.label.startsWith("PNG") ? "image/png" : sn?.label.startsWith("JPEG") ? "image/jpeg" : sn?.label.startsWith("GIF") ? "image/gif" : sn?.label.startsWith("WebP") ? "image/webp" : "";
    return URL.createObjectURL(new Blob([bytes], t ? { type: t } : undefined));
  }, [bytes, kind0, eff, sn]);
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  const text = useMemo(() => {
    if (!bytes || !["markdown", "html", "code", "csv", "json", "notebook", "rtf"].includes(eff)) return null;
    return decodeText(bytes.byteLength > TEXT_CAP ? bytes.slice(0, TEXT_CAP) : bytes);
  }, [bytes, eff]);
  const truncated = !!bytes && bytes.byteLength > TEXT_CAP;
  const [htmlTab, setHtmlTab] = useState<"preview" | "source">("preview");

  const canEdit = !isLive && editable(file.name, file.mime) && ["markdown", "html", "code", "csv", "json"].includes(eff);
  const dl = `/api/drive/download?file_id=${encodeURIComponent(file.id)}`;
  const urlKind = eff === "image" || eff === "video" || eff === "audio";
  const src = blobUrl ?? embedUrl;

  let body: React.ReactNode;
  if (needBytes && loading) body = <Loading />;
  else if (needBytes && error) body = <Problem msg={tooLarge ? `This file is ${fmtBytes(file.size)} — too large to open in the browser. Download it to read it.` : error} dl={!isLive ? dl : null} />;
  else if (!needBytes && embedErr) body = <Problem msg={embedErr} dl={!isLive ? dl : null} />;
  else if (urlKind && !src) body = <Loading />;
  else if (eff === "image" && src) body = <ImageView url={src} name={file.name} bytesUrl={rawUrl} isSvg={file.name.toLowerCase().endsWith(".svg")} />;
  else if (eff === "video" && src) body = <VideoPlayer src={src} fileName={file.name} googleId={file.googleId} size={file.size} canDownload={!isLive} downloadHref={dl} />;
  else if (eff === "audio" && src) body = (
    <div className="p-8 sm:p-14 max-w-xl mx-auto text-center">
      <div className="mx-auto size-24 rounded-2xl bg-tint text-brand grid place-items-center text-[40px]" aria-hidden="true">♪</div>
      <p className="mt-4 text-[15px] font-medium break-all">{file.name}</p>
      <audio src={src} controls className="w-full mt-6" preload="metadata" />
    </div>
  );
  else if (!bytes) body = <Loading />;
  else if (eff === "pdf") body = <PdfView bytes={bytes} fallbackUrl={embedUrl} />;
  else if (eff === "markdown" && text !== null) body = <MarkdownView text={text} />;
  else if (eff === "html" && text !== null) body = (
    <div className="flex flex-col h-full min-h-0">
      <div role="tablist" aria-label="HTML view" className="flex gap-1 px-3 py-2 border-b border-line shrink-0 text-[12.5px]">
        {(["preview", "source"] as const).map((t) => <button key={t} role="tab" aria-selected={htmlTab === t} onClick={() => setHtmlTab(t)} className={`min-h-[36px] px-3 rounded-md capitalize ${htmlTab === t ? "bg-tint text-brand font-medium" : "text-muted hover:bg-tint/60"}`}>{t}</button>)}
        <span className="flex-1" /><span className="text-muted self-center">Scripts are blocked in the preview.</span>
      </div>
      <div className="flex-1 min-h-0">{htmlTab === "preview"
        ? <iframe srcDoc={text} sandbox="" referrerPolicy="no-referrer" title={`HTML preview of ${file.name}`} className="w-full h-full border-0 bg-white" />
        : <TextView text={text} />}</div>
    </div>
  );
  else if (eff === "csv" && text !== null) body = <CsvView text={text} />;
  else if (eff === "json" && text !== null) body = <JsonView text={text} />;
  else if (eff === "notebook" && text !== null) body = <NotebookView text={text} />;
  else if (eff === "rtf" && text !== null) body = <TextView text={rtfToText(text)} note="Plain-text view of this Rich Text document — formatting is not reproduced." />;
  else if (eff === "code" && text !== null) body = <TextView text={text} note={truncated ? `Showing the first ${fmtBytes(TEXT_CAP)} of ${fmtBytes(bytes.byteLength)}. Download for the rest.` : kind0 === "unknown" ? "Unknown file type — shown as text because it looks like text." : undefined} />;
  else if (eff === "docx") body = <DocxView bytes={bytes} />;
  else if (eff === "sheet") body = <SheetView bytes={bytes} />;
  else if (eff === "slides") body = <SlidesView bytes={bytes} />;
  else if (eff === "odf") body = <OdfView bytes={bytes} />;
  else if (eff === "ebook") body = <EbookView bytes={bytes} />;
  else if (eff === "archive") body = <ArchiveView bytes={bytes} name={file.name} />;
  else if (eff === "font") body = <FontView bytes={bytes} name={file.name} />;
  else body = <BinaryView bytes={bytes} name={file.name} note={eff === "legacy" ? "Legacy Office formats (.doc, .ppt, .msg…) have no safe in-browser renderer. This is the readable text inside the file — download it for the full document." : undefined} />;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-5" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="pop-in relative w-full max-w-6xl h-[92vh] rounded-xl bg-surface border border-line shadow-pop flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 min-h-[56px] border-b border-line shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium truncate">{file.name}</p>
            <p className="text-[11.5px] text-muted truncate">{LABEL[eff]}{sn && kind0 === "unknown" ? ` · detected: ${sn.label}` : ""}{file.size ? ` · ${fmtBytes(file.size)}` : ""}</p>
          </div>
          {canEdit && <button onClick={() => onEdit(file)} className="min-h-[40px] px-3 rounded-md border border-line text-[13px] flex items-center gap-1.5 hover:bg-tint"><Pencil size={14} /> Edit</button>}
          {file.googleId && <a href={`https://drive.google.com/file/d/${file.googleId}/view`} target="_blank" rel="noreferrer" className="hidden sm:flex min-h-[40px] px-3 rounded-md border border-line text-[13px] items-center gap-1.5 hover:bg-tint"><ExternalLink size={14} /> Google Drive</a>}
          {!isLive && <a href={dl} className="min-h-[40px] px-3 rounded-md border border-line text-[13px] flex items-center gap-1.5 hover:bg-tint"><Download size={14} /> <span className="hidden sm:inline">Download</span></a>}
          <button onClick={onClose} aria-label="Close preview" className="size-11 grid place-items-center rounded-md hover:bg-tint"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">{body}</div>
      </div>
    </div>
  );
}

function Problem({ msg, dl }: { msg: string; dl: string | null }) {
  return (
    <div className="p-10 text-center">
      <FileWarning size={30} className="mx-auto text-muted" />
      <p className="mt-3 text-[14px] max-w-md mx-auto">{msg}</p>
      {dl && <a href={dl} className="mt-4 inline-flex min-h-[44px] items-center px-4 rounded-md bg-brand text-white text-sm font-medium">Download instead</a>}
    </div>
  );
}
