"use client";
import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { FileIcon } from "../ui/Glyphs";
import { viewKind, nativeVideo, needsHelp, googleIdOf } from "./filetext";
import type { FileRow } from "./Explorer";

// Signed Storage URLs live 5 minutes server-side — cache them for 4 so a
// scrolled-back cover never points at an expired link.
const URL_TTL = 4 * 60_000;
const urlCache = new Map<string, { url: string; at: number }>();

async function signedUrl(f: FileRow): Promise<string | null> {
  const hit = urlCache.get(f.id);
  if (hit && Date.now() - hit.at < URL_TTL) return hit.url;
  const r = await fetch(`/api/drive/download?file_id=${encodeURIComponent(f.id)}&json=1`);
  const d = await r.json().catch(() => ({}));
  if (r.ok && d.url) { urlCache.set(f.id, { url: d.url, at: Date.now() }); return d.url; }
  return null;
}

const thumbUrl = (f: FileRow) => `/api/drive/download?file_id=${encodeURIComponent(f.id)}&thumb=1`;
const rawUrl = (f: FileRow) => `/api/drive/download?file_id=${encodeURIComponent(f.id)}&raw=1`;

type Stage = "google" | "direct" | "decode" | "dead";

// Cover art for visual files, a clean page icon for everything else.
// Source chain per file, first success wins:
//  1. google — Drive's server-side thumbnail (small, fast, any visual format).
//     First choice for Google-hosted files: never stream full bytes for a cover.
//  2. direct — Storage signed URL (or raw stream) decoded by the browser.
//  3. decode — TIFF via utif, HEIC via heic2any (Storage files only).
//  4. dead — the file's page icon, same as non-visual files.
export default function FileThumb({ file, size = 40 }: { file: FileRow; size?: number }) {
  const kind = viewKind(file.name, file.mime);
  const visual = kind === "image" || kind === "video";
  const gid = googleIdOf(file.id, file.google_file_id);
  const local = !!file.storage_path;
  const hardImage = kind === "image" && needsHelp(file.name, file.mime);
  const start: Stage = gid && (!local || hardImage || (kind === "video" && !nativeVideo(file.name, file.mime))) ? "google" : "direct";

  const [stage, setStage] = useState<Stage>(start);
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [near, setNear] = useState(false);
  const tried = useRef(new Set<Stage>());
  const ref = useRef<HTMLSpanElement>(null);

  // Nothing loads until the tile scrolls near the viewport.
  useEffect(() => {
    if (!visual || near) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visual, near]);

  function advance() {
    tried.current.add(stage);
    setUrl(null);
    setLoaded(false);
    const next: Stage =
      stage === "google" ? (local || nativeVideo(file.name, file.mime) || !hardImage ? "direct" : "dead")
      : stage === "direct" ? (gid && !tried.current.has("google") ? "google" : hardImage && local ? "decode" : "dead")
      : "dead";
    setStage(tried.current.has(next) ? "dead" : next);
  }

  // Resolve the source URL for the current stage.
  useEffect(() => {
    if (!visual || !near || url) return;
    let gone = false;
    (async () => {
      try {
        if (stage === "google") { setUrl(thumbUrl(file)); return; }
        if (stage === "direct") {
          const u = local ? await signedUrl(file) : rawUrl(file);
          if (gone) return;
          if (!u) { advance(); return; }
          // Video: jump past frame 0, which is often black.
          setUrl(kind === "video" ? `${u}#t=0.5` : u);
          return;
        }
        if (stage === "decode") {
          const u = await signedUrl(file);
          if (!u) throw new Error("no bytes");
          const buf = await fetch(u).then((r) => { if (!r.ok) throw new Error("fetch failed"); return r.arrayBuffer(); });
          const head = new Uint8Array(buf, 0, 12);
          const isTiff = (head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) || (head[0] === 0x4d && head[1] === 0x4d && head[3] === 0x2a);
          let out: string;
          if (isTiff) {
            const UTIF = (await import("utif")).default;
            const ifds = UTIF.decode(buf);
            if (!ifds?.length) throw new Error("not a tiff");
            UTIF.decodeImage(buf, ifds[0]);
            const rgba = UTIF.toRGBA8(ifds[0]);
            const c = document.createElement("canvas");
            c.width = ifds[0].width; c.height = ifds[0].height;
            const px = new Uint8ClampedArray(rgba.length);
            px.set(rgba);
            c.getContext("2d")!.putImageData(new ImageData(px, c.width, c.height), 0, 0);
            out = c.toDataURL("image/png");
          } else {
            const heic2any = (await import("heic2any")).default;
            const res = await heic2any({ blob: new Blob([buf]), toType: "image/jpeg", quality: 0.8 });
            out = URL.createObjectURL(Array.isArray(res) ? res[0] : res);
          }
          if (!gone) setUrl(out);
        }
      } catch {
        if (!gone) advance();
      }
    })();
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, near, url, file.id]);

  const box: React.CSSProperties = { width: size, height: size };

  // Non-visual files (and covers that never resolved): the page icon, centred, no tile.
  if (!visual || stage === "dead") {
    return (
      <span ref={ref} style={box} className="grid place-items-center shrink-0" aria-hidden="true">
        <FileIcon name={file.name} mime={file.mime} size={Math.round(size * 0.82)} />
      </span>
    );
  }

  const media = "absolute inset-0 h-full w-full object-cover transition-opacity duration-200";
  const radius = size >= 56 ? "rounded-lg" : "rounded-[6px]";
  const isVideoEl = kind === "video" && stage === "direct";
  return (
    <span ref={ref} style={box} aria-hidden="true"
      className={`relative shrink-0 overflow-hidden ${radius} bg-soft ring-1 ring-inset ring-line ${loaded ? "" : "skel"}`}>
      {url && (isVideoEl ? (
        <video src={url} preload="metadata" muted playsInline disablePictureInPicture
          onLoadedData={() => setLoaded(true)} onError={advance} className={`${media} ${loaded ? "opacity-100" : "opacity-0"}`} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" decoding="async"
          onLoad={() => setLoaded(true)} onError={advance} className={`${media} ${loaded ? "opacity-100" : "opacity-0"}`} />
      ))}
      {/* Inner hairline keeps white images (screenshots, docs) from melting into the page. */}
      <span className={`pointer-events-none absolute inset-0 ${radius} ring-1 ring-inset ring-black/10`} />
      {kind === "video" && loaded && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid place-items-center rounded-full bg-black/55 text-white backdrop-blur-[2px]"
            style={{ width: Math.max(14, Math.round(size * 0.38)), height: Math.max(14, Math.round(size * 0.38)) }}>
            <Play size={Math.max(8, Math.round(size * 0.18))} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" />
          </span>
        </span>
      )}
    </span>
  );
}
