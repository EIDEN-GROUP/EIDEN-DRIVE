"use client";
import { useEffect, useRef, useState } from "react";
import { FileIcon } from "../ui/Glyphs";
import { viewKind } from "./filetext";
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

// Windows-style cover: real pixels for images + first-frame for video,
// tidy generic tile for everything else. Lazy-loads when scrolled into view.
export default function FileThumb({ file, size = 40 }: { file: FileRow; size?: number }) {
  const kind = viewKind(file.name, file.mime);
  const visual = kind === "image" || kind === "video";
  const [url, setUrl] = useState<string | null>(null);
  const [dead, setDead] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visual) return;
    let gone = false;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      resolveUrl(file).then((u) => { if (!gone) setUrl(u); }).catch(() => { if (!gone) setDead(true); });
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => { gone = true; io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const box: React.CSSProperties = { width: size, height: size };
  if (!visual || dead) {
    return (
      <span ref={ref} style={box} className="rounded-md bg-tint grid place-items-center shrink-0 overflow-hidden" aria-hidden="true">
        <FileIcon name={file.name} mime={file.mime} folder={false} size={Math.max(18, Math.round(size * 0.55))} />
      </span>
    );
  }
  if (!url) {
    return <span ref={ref} style={box} className="skel shrink-0" aria-hidden="true" />;
  }
  if (kind === "video") {
    return (
      <span ref={ref} style={box} className="rounded-md bg-black grid place-items-center shrink-0 overflow-hidden" aria-hidden="true">
        {/* preload="none" + loaded on visibility would be cheaper; metadata shows frame one */}
        <video src={url} preload="metadata" muted playsInline disablePictureInPicture
          onError={() => setDead(true)} style={{ width: size, height: size, objectFit: "cover" }} />
      </span>
    );
  }
  return (
    <span ref={ref} style={box} className="rounded-md bg-tint grid place-items-center shrink-0 overflow-hidden" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" loading="lazy" onError={() => setDead(true)} style={{ width: size, height: size, objectFit: "cover" }} />
    </span>
  );
}
