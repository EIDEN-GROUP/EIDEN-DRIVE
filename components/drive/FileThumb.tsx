"use client";
import { useEffect, useRef, useState } from "react";
import { FileIcon } from "../ui/Glyphs";
import { viewKind, nativeVideo, needsHelp, googleIdOf } from "./filetext";
import type { FileRow } from "./Explorer";

// Signed-URL cache: one ?json=1 fetch per Storage file per session.
const urlCache = new Map<string, string>();

async function resolveUrl(f: FileRow): Promise<string | null> {
  const hit = urlCache.get(f.id);
  if (hit) return hit;
  if (f.storage_path) {
    const r = await fetch(`/api/drive/download?file_id=${encodeURIComponent(f.id)}&json=1`);
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.url) { urlCache.set(f.id, d.url); return d.url; }
    return null;
  }
  // Google-hosted (indexed or live): stream through the same-origin endpoint.
  return `/api/drive/download?file_id=${encodeURIComponent(f.id)}&raw=1`;
}

function thumbUrl(f: FileRow): string {
  return `/api/drive/download?file_id=${encodeURIComponent(f.id)}&thumb=1`;
}

type Stage = "google" | "direct" | "decode" | "dead";

// Windows-style cover for EVERY visual format. Chain per file, first success wins:
//  1. google — Drive's server-side thumbnail (RAW, PSD, TIFF, HEIC, any video,
//     PDF…). Works for any file Google can see, regardless of browser support.
//  2. direct — the browser decodes it itself (<img> / first video frame).
//  3. decode — TIFF via utif, HEIC via heic2any, drawn to a canvas (Storage files).
//  4. dead — honest generic tile. Never a black box, never a broken icon.
export default function FileThumb({ file, size = 40 }: { file: FileRow; size?: number }) {
  const kind = viewKind(file.name, file.mime);
  const visual = kind === "image" || kind === "video";
  const gid = googleIdOf(file.id, file.google_file_id);
  const exoticVideo = kind === "video" && !nativeVideo(file.name, file.mime);
  const hardImage = kind === "image" && needsHelp(file.name, file.mime);
  const start: Stage = gid && (exoticVideo || hardImage) ? "google" : "direct";

  const [stage, setStage] = useState<Stage>(start);
  const [url, setUrl] = useState<string | null>(start === "google" ? thumbUrl(file) : null);
  const [canvasUrl, setCanvasUrl] = useState<string | null>(null);
  const seen = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  // Direct bytes load lazily, only when scrolled near.
  useEffect(() => {
    if (!visual || stage !== "direct" || url) return;
    let gone = false;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      resolveUrl(file).then((u) => {
        if (gone) return;
        if (u) setUrl(u);
        else if (gid) setStage("google");
        else setStage("dead");
      }).catch(() => { if (!gone) setStage(gid ? "google" : "dead"); });
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => { gone = true; io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, stage]);

  // In-browser decode for TIFF / HEIC on Storage files (no Google to ask).
  useEffect(() => {
    if (stage !== "decode" || seen.current) return;
    seen.current = true;
    let gone = false;
    (async () => {
      try {
        const u = url ?? (await resolveUrl(file));
        if (!u) throw new Error("no bytes");
        const buf = await fetch(u).then((r) => {
          if (!r.ok) throw new Error("fetch failed");
          return r.arrayBuffer();
        });
        const head = new Uint8Array(buf, 0, 12);
        const isTiff = (head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) || (head[0] === 0x4d && head[1] === 0x4d && head[3] === 0x2a);
        let dataUrl: string;
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
          dataUrl = c.toDataURL("image/png");
        } else {
          const heic2any = (await import("heic2any")).default;
          const out = await heic2any({ blob: new Blob([buf]), toType: "image/jpeg", quality: 0.9 });
          const blob = Array.isArray(out) ? out[0] : out;
          dataUrl = URL.createObjectURL(blob);
        }
        if (!gone) setCanvasUrl(dataUrl);
      } catch {
        if (!gone) setStage("dead");
      }
    })();
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const box: React.CSSProperties = { width: size, height: size };
  const imgCls = "rounded-md bg-tint grid place-items-center shrink-0 overflow-hidden";
  const fail = () => {
    // Advance one rung: google → direct → decode → dead.
    if (stage === "google") {
      if (kind === "video" && nativeVideo(file.name, file.mime)) { setUrl(null); setStage("direct"); }
      else setStage("dead");
    } else if (stage === "direct") {
      if (gid) setStage("google");
      else if (hardImage && !seen.current) setStage("decode");
      else setStage("dead");
    } else setStage("dead");
  };

  if (!visual || stage === "dead") {
    return (
      <span ref={ref} style={box} className={imgCls} aria-hidden="true">
        <FileIcon name={file.name} mime={file.mime} folder={false} size={Math.max(18, Math.round(size * 0.55))} />
      </span>
    );
  }
  if (stage === "decode") {
    if (!canvasUrl) return <span ref={ref} style={box} className="skel shrink-0" aria-hidden="true" />;
    return (
      <span ref={ref} style={box} className={imgCls} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={canvasUrl} alt="" loading="lazy" style={{ width: size, height: size, objectFit: "cover" }} />
      </span>
    );
  }
  if (stage === "google") {
    const g = thumbUrl(file);
    if (kind === "video" && !nativeVideo(file.name, file.mime)) {
      // Non-native video: a <video> tag would sit black — Google's thumb instead.
      return (
        <span ref={ref} style={box} className={imgCls} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={g} alt="" loading="lazy" onError={fail} style={{ width: size, height: size, objectFit: "cover" }} />
        </span>
      );
    }
    return (
      <span ref={ref} style={box} className={imgCls} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={g} alt="" loading="lazy" onError={fail} style={{ width: size, height: size, objectFit: "cover" }} />
      </span>
    );
  }
  if (!url) {
    return <span ref={ref} style={box} className="skel shrink-0" aria-hidden="true" />;
  }
  if (kind === "video") {
    return (
      <span ref={ref} style={box} className="rounded-md bg-black grid place-items-center shrink-0 overflow-hidden" aria-hidden="true">
        <video src={url} preload="metadata" muted playsInline disablePictureInPicture
          onError={fail} style={{ width: size, height: size, objectFit: "cover" }} />
      </span>
    );
  }
  return (
    <span ref={ref} style={box} className={imgCls} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" loading="lazy" onError={fail} style={{ width: size, height: size, objectFit: "cover" }} />
    </span>
  );
}
