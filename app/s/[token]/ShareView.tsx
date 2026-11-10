"use client";
// Public share landing: same preview engine as the in-app viewer, tuned for
// sign-in-less visitors — dark canvas, glow, app-icon types, one-tap download.
// No edit controls, no sidebar; the URL is the capability.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Share2, X, ExternalLink, Search } from "lucide-react";
import Logo from "@/components/ui/Logo";
import MarkdownView from "@/components/viewer/MarkdownView";
import TextView from "@/components/viewer/TextView";
import { FileIcon } from "@/components/ui/Glyphs";

interface ChildMeta { id: string; name: string; mime: string; size: number; googleId: string | null; folder_id: string | null }
interface Meta {
  kind?: "file" | "folder";
  name: string; mime: string; size: number; backends: string[];
  hasCover: boolean; googleId: string | null;
  children?: ChildMeta[]; hasMore?: boolean;
}

function fmtSize(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${u[i]}`;
}
const GFOLDER = "application/vnd.google-apps.folder";
const isImgMime = (m: string) => m.startsWith("image/");
const isVidMime = (m: string) => m.startsWith("video/");
const isAudMime = (m: string) => m.startsWith("audio/");
const isTextMime = (m: string) => m.startsWith("text/") || m === "application/json" || m === "application/xml" || m === "application/x-sh" || m === "application/javascript";

// File-icon asset helper: picture backdrops come from Google/Storage directly.
function coverSrc(rawBase: string, c: { id: string }): string {
  return `${rawBase}?file=${encodeURIComponent(c.id)}`;
}

// A child previewable inline — same rules as the main file view.
function isChildPreviewable(c: ChildMeta): boolean {
  if (c.mime === GFOLDER) return false;
  return isImgMime(c.mime) || isVidMime(c.mime) || isAudMime(c.mime) ||
         c.mime === "application/pdf" || isTextMime(c.mime) || /\.md$|\.markdown$/i.test(c.name);
}

function CtPreview({ c, token, onClose }: { c: ChildMeta; token: string; onClose: () => void }) {
  const src = `/api/share/${token}/raw?file=${encodeURIComponent(c.id)}`;
  const [text, setText] = useState<string | null>(null);
  const [vidFail, setVidFail] = useState(false);
  useEffect(() => {
    if (!isTextMime(c.mime) && !/\.md$|\.markdown$/i.test(c.name)) return;
    if (c.size > 5 * 1024 * 1024) return;
    let gone = false;
    fetch(src).then((r) => r.ok ? r.arrayBuffer() : Promise.reject()).then((buf) => {
      if (gone) return;
      try { setText(new TextDecoder().decode(buf)); } catch { /* binary after all */ }
    }).catch(() => {});
    return () => { gone = true; };
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = c.name.toLowerCase();
  const isMd = /\.md$|\.markdown$/.test(e) || c.mime === "text/markdown";
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/85 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={`Preview ${c.name}`}>
      <div className="flex items-center gap-3 px-4 sm:px-6 h-16 border-b border-white/10 text-white/90">
        <span className="min-w-0 flex-1 text-[14px] font-medium truncate">{c.name}</span>
        <a href={src} className="min-h-[40px] inline-flex items-center gap-1.5 text-[13px] text-white/80 hover:text-white"><Download size={14} /> Download</a>
        <button onClick={onClose} aria-label="Close" className="size-10 grid place-items-center rounded-md text-white/70 hover:text-white hover:bg-white/10"><X size={18} /></button>
      </div>
      <div className="flex-1 min-h-0 grid place-items-center p-4 sm:p-8">
        {isImgMime(c.mime) && <img src={src} alt={c.name} className="max-h-[78vh] max-w-full rounded-lg object-contain shadow-2xl" />}
        {isVidMime(c.mime) && (vidFail && c.googleId
          ? <iframe src={`https://drive.google.com/file/d/${c.googleId}/preview`} title={`Video ${c.name}`} className="w-[min(1100px,100%)] h-[min(78vh,720px)] border-0 bg-black" allow="autoplay; fullscreen" allowFullScreen />
          : <video src={src} controls playsInline preload="metadata" onError={() => setVidFail(true)} className="max-h-[78vh] max-w-full rounded-lg bg-black shadow-2xl">Video preview unavailable.</video>)}
        {isAudMime(c.mime) && <audio src={src} controls autoPlay className="w-[min(480px,80vw)]" />}
        {c.mime === "application/pdf" && <iframe src={src} title={c.name} className="w-[min(1100px,100%)] h-[78vh] rounded-lg border border-white/10 bg-white" />}
        {isMd && text !== null && <div className="w-[min(720px,94vw)] h-[78vh] overflow-auto bg-surface rounded-lg p-5 text-ink"><div className="md-body"><MarkdownView text={text} /></div></div>}
        {!isMd && isTextMime(c.mime) && text !== null && <div className="w-[min(720px,94vw)] h-[78vh] overflow-auto bg-surface rounded-lg p-5 text-ink"><TextView text={text} /></div>}
        {((!isImgMime(c.mime) && !isVidMime(c.mime) && !isAudMime(c.mime) && c.mime !== "application/pdf" && text === null)) && (
          <div className="text-center"><FileIcon name={c.name} mime={c.mime} size={80} /><p className="mt-4 text-white/85 text-[16px] font-medium">Preview isn't available for this file</p><a href={src} className="mt-4 inline-flex min-h-[48px] items-center px-5 rounded-lg bg-white text-ink text-[15px] font-medium"><Download size={16} className="mr-2" />Download</a></div>
        )}
      </div>
    </div>
  );
}

export default function ShareView({ token, initial }: { token: string; initial: { name: string; mime: string; size: number } | null }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [dead, setDead] = useState(false);
  const [childSel, setChildSel] = useState<ChildMeta | null>(null);
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [vidFail, setVidFail] = useState(false);
  const raw = `/api/share/${token}/raw`;

  useEffect(() => {
    let gone = false;
    fetch(`/api/share/${token}/meta`).then((r) => r.json().then((d) => ({ ok: r.ok, d })).catch(() => ({ ok: false, d: {} }))).then(({ ok, d }) => {
      if (gone) return;
      if (!ok) { setDead(true); return; }
      setMeta(d);
    }).catch(() => { if (!gone) setDead(true); });
    return () => { gone = true; };
  }, [token]);

  useEffect(() => {
    if (!meta) return;
    const textual = meta.mime.startsWith("text/") || meta.mime === "application/json" || /\.md$|\.markdown$/i.test(meta.name);
    if (!textual || meta.size > 5 * 1024 * 1024) return;
    let gone = false;
    fetch(raw).then((r) => r.arrayBuffer()).then((buf) => {
      if (gone) return;
      try { setText(new TextDecoder().decode(buf)); } catch { /* binary */ }
    }).catch(() => {});
    return () => { gone = true; };
  }, [meta, raw]);

  const name = meta?.name ?? initial?.name ?? "Shared item";
  const mime = meta?.mime ?? initial?.mime ?? "";
  const kind = meta?.kind;
  const isFile = kind !== "folder";
  const isImg = isFile && isImgMime(mime);
  const isVid = isFile && isVidMime(mime);
  const isAud = isFile && isAudMime(mime);
  const isPdf = isFile && mime === "application/pdf";
  const isMd = isFile && /\.md$|\.markdown$/i.test(name);
  const isText = isFile && isTextMime(mime);
  const textFor = isMd || isText ? text : null;
  const filtered = (meta?.children ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  const shown = showAll ? filtered : filtered.slice(0, 60);

  return (
    <main className="min-h-dvh grid place-items-center bg-gradient-to-br from-[#0f0c1d] via-[#131229] to-[#1c1638] p-4 sm:p-8">
      <section
        aria-label={dead ? "Link unavailable" : `Shared file ${name} from Eiden Drive`}
        className="w-full max-w-5xl rounded-[28px] overflow-hidden border border-white/10 bg-[#191933] shadow-[0_60px_120px_-40px_rgba(91,63,208,.55),0_8px_32px_rgba(0,0,0,.5)]">

        {/* Brand bar */}
        <header className="flex items-center gap-4 px-5 sm:px-8 h-16 border-b border-white/8 bg-black/20">
          <Logo size={30} />
          <span className="text-[12px] tracking-[.18em] uppercase text-white/50">Shared via Eiden Drive</span>
          <span className="ml-auto flex items-center gap-2 text-[11px] text-white/40 tabular-nums">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" /> Encrypted link
          </span>
        </header>

        {dead || (meta === null && initial === null) ? (
          <div className="px-8 py-20 text-center">
            <p className="text-[20px] font-semibold text-white/90">This link doesn't work anymore</p>
            <p className="mt-2 text-[14px] text-white/50">It expired, was revoked, or the file was deleted. Ask the sender for a fresh link.</p>
            <Link href="/" className="mt-6 inline-flex min-h-[44px] items-center px-5 rounded-lg bg-brand text-white text-[14px] font-medium">Back to Eiden Drive</Link>
          </div>
        ) : meta?.kind === "folder" ? (
          <div className="grid md:grid-cols-[1fr_420px] min-h-[60dvh]">
            {/* Folder browse — left pane */}
            <div className="flex flex-col p-5 sm:p-7">
              <p className="text-[11px] font-semibold uppercase tracking-[.2em] text-[#a78bfa]">Folder</p>
              <h1 className="mt-1.5 text-[28px] sm:text-[34px] leading-tight font-semibold text-white truncate" title={name}>{name}</h1>
              <p className="mt-1 text-[13px] text-white/45 tabular-nums">{filtered.length} item{filtered.length === 1 ? "" : "s"}</p>
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 min-h-[44px] focus-within:border-[#8b76ff]">
                <Search size={15} className="text-white/35" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in this folder…" aria-label="Search items" className="flex-1 min-w-0 bg-transparent text-[14px] text-white placeholder-white/35 focus:outline-none" />
                {q && <button onClick={() => setQ("")} aria-label="Clear" className="size-8 grid place-items-center text-white/40 hover:text-white"><X size={14} /></button>}
              </div>
              <ul className="mt-4 overflow-y-auto max-h-[52dvh] divide-y divide-white/5 pr-2 -mr-2 scrollbar-thin">
                {shown.map((c) => {
                  const isFolder = c.mime === GFOLDER;
                  return (
                    <li key={c.id}>
                      <button disabled={!isChildPreviewable(c) && !isFolder} onClick={() => isChildPreviewable(c) && setChildSel(c)}
                        className="w-full min-h-[56px] flex items-center gap-3 px-2 rounded-lg text-left group disabled:cursor-default enabled:hover:bg-white/6 transition-colors">
                        {isImgMime(c.mime) ? (
                          <img src={coverSrc(raw, c)} alt="" loading="lazy" className="size-12 rounded-md object-cover border border-white/10 bg-black/40" />
                        ) : (
                          <span className="size-12 grid place-items-center rounded-md bg-white/5 border border-white/8 shrink-0"><FileIcon name={c.name} mime={c.mime} folder={isFolder} size={26} /></span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-medium text-white/90 truncate group-enabled:group-hover:text-white">{c.name}</span>
                          <span className="block text-[11px] text-white/35 tabular-nums">{isFolder ? "Folder" : fmtSize(c.size)}</span>
                        </span>
                        {!isFolder && <Download size={14} className="text-white/30 group-enabled:group-hover:text-white/70" />}
                      </button>
                    </li>
                  );
                })}
                {shown.length === 0 && <li className="py-10 text-center text-[13px] text-white/35">{q ? `Nothing matches “${q}”` : "Folder is empty."}</li>}
              </ul>
              {filtered.length > shown.length && (
                <button onClick={() => setShowAll(true)} className="mt-2 min-h-[40px] self-start px-3 rounded-md text-[12.5px] text-[#a78bfa] hover:bg-white/5">Show all {filtered.length} items</button>
              )}
            </div>
            {/* Folder detail / brand panel — right */}
            <aside className="relative flex flex-col justify-between bg-gradient-to-br from-[#5b3fd0] via-[#4332b0] to-[#2a1a66] p-5 sm:p-7 border-l border-white/10">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[.2em] text-white/60">Secure Folder</p>
                <div className="mt-6 grid place-items-center"><FileIcon name={name} mime={GFOLDER} folder size={168} /></div>
                <p className="mt-6 text-center text-[12.5px] text-white/65">Only people with this link can see inside.<br />Nothing travels without permission.</p>
              </div>
              <div className="space-y-3">
                <Link href="/login" className="flex items-center justify-center gap-2 min-h-[48px] rounded-lg bg-white text-[#4332b0] text-[14px] font-semibold hover:bg-white/90 transition-colors"><Share2 size={16} /> Open in Eiden Drive</Link>
                <p className="text-center text-[10.5px] text-white/40">© {new Date().getFullYear()} EIDEN GROUP · <Link className="underline" href="/privacy">Privacy</Link> · <Link className="underline" href="/terms">Terms</Link></p>
              </div>
            </aside>
          </div>
        ) : !meta ? (
          <div className="grid md:grid-cols-[1.3fr_1fr] min-h-[60dvh]">
            <div className="p-6 sm:p-8 flex items-center justify-center bg-black/30"><div className="skel size-40 rounded-3xl" /></div>
            <div className="p-6 sm:p-8 space-y-5"><div className="skel h-7 w-2/3" /><div className="skel h-5 w-1/3" /><div className="skel h-14 w-full" /><div className="skel h-14 w-full" /></div>
          </div>
        ) : (
          <div className="grid md:grid-cols-[1.35fr_1fr] min-h-[60dvh]">
            {/* Preview surface — left */}
            <div className="relative bg-black/40 grid place-items-center p-4 sm:p-6 overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_30%,rgba(91,63,208,.35),transparent)] pointer-events-none" aria-hidden="true" />
              {isImg && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={raw} alt={name} className="relative max-h-[74dvh] max-w-full rounded-xl object-contain shadow-2xl" />
              )}
              {isVid && (vidFail && meta?.googleId
                ? <iframe src={`https://drive.google.com/file/d/${meta.googleId}/preview`} title={`Video ${name}`} className="relative w-full h-[min(74dvh,620px)] border-0" allow="autoplay; fullscreen" allowFullScreen />
                : <video src={raw} controls playsInline preload="metadata" onError={() => setVidFail(true)} className="relative w-full max-h-[74dvh] bg-black rounded-xl">Video preview unavailable — <a href={raw} className="underline">open directly</a></video>)}
              {isAud && (
                <div className="relative text-center space-y-6">
                  <div className="mx-auto size-28 grid place-items-center rounded-3xl bg-[#5b3fd0]/30 border border-[#8b76ff]/30"><FileIcon name={name} mime={mime} size={64} /></div>
                  <audio src={raw} controls preload="metadata" className="w-[min(520px,80vw)]" />
                </div>
              )}
              {isPdf && <iframe src={raw} title={name} className="relative w-full h-[min(74dvh,680px)] rounded-xl border border-white/10 bg-white" />}
              {isMd && textFor ? <div className="relative w-full h-[min(74dvh,680px)] overflow-auto rounded-xl bg-surface p-6 text-ink"><div className="md-body"><MarkdownView text={textFor} /></div></div> : null}
              {isText && textFor ? <div className="relative w-full h-[min(74dvh,680px)] overflow-auto rounded-xl bg-surface p-6 text-ink"><TextView text={textFor} /></div> : null}
              {!isImg && !isVid && !isAud && !isPdf && !isMd && !isText && (
                <div className="relative text-center"><FileIcon name={name} mime={mime} size={110} /><p className="mt-5 text-[15px] text-white/70">Preview isn't available for this format.</p></div>
              )}
            </div>
            {/* Meta + action — right */}
            <aside className="flex flex-col justify-between p-5 sm:p-8 border-l border-white/8 bg-[#141428]">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[.2em] text-[#a78bfa]">Secure File</p>
                <h1 className="mt-2 text-[22px] sm:text-[26px] leading-tight font-semibold text-white break-words">{name}</h1>
                <p className="mt-2 text-[12px] text-white/40 tabular-nums">{fmtSize(meta?.size ?? 0)}</p>
                <p className="mt-6 text-[13px] leading-relaxed text-white/55">Shared privately via a single link. No signup needed to preview it — only share with the people it concerns.</p>
              </div>
              <div className="mt-8 space-y-2">
                <a href={raw} className="flex items-center justify-center gap-2 min-h-[54px] rounded-xl bg-[#5b3fd0] text-white text-[15px] font-semibold hover:bg-[#6a4ae0] transition-colors shadow-[0_12px_32px_-8px_rgba(91,63,208,.6)]"><Download size={18} /> Download</a>
                {isVid && meta?.googleId && <a href={`https://drive.google.com/file/d/${meta.googleId}/view`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 min-h-[48px] rounded-xl border border-white/12 text-[13px] text-white/70 hover:text-white hover:border-white/25"><ExternalLink size={15} /> Open in Google Drive</a>}
                <p className="pt-2 text-center text-[10.5px] text-white/35">© {new Date().getFullYear()} EIDEN GROUP · <Link className="underline" href="/privacy">Privacy</Link> · <Link className="underline" href="/terms">Terms</Link></p>
              </div>
            </aside>
          </div>
        )}
      </section>

      {/* Inline child preview (folder items) */}
      {childSel && <CtPreview c={childSel} token={token} onClose={() => setChildSel(null)} />}
    </main>
  );
}
