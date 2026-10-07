"use client";
import { useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus, RotateCw, Code2 } from "lucide-react";
import TextView from "./TextView";

/** Images with zoom (wheel / pinch-free buttons), drag-to-pan, rotate, fit/100%. Falls back to decoding HEIC and TIFF in the browser. */
export default function ImageView({ url, name, bytesUrl, isSvg }: { url: string; name: string; bytesUrl: string; isSvg?: boolean }) {
  const [src, setSrc] = useState(url);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [state, setState] = useState<"ok" | "decoding" | "failed">("ok");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const tried = useRef(false);

  // The browser can't decode HEIC/TIFF natively (Safari can HEIC) — decode them ourselves, lazily.
  async function onError() {
    if (tried.current) { setState("failed"); return; }
    tried.current = true; setState("decoding");
    try {
      const buf = await fetch(bytesUrl).then((r) => r.arrayBuffer());
      const head = new Uint8Array(buf, 0, 12);
      const isTiff = (head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a) || (head[0] === 0x4d && head[1] === 0x4d && head[3] === 0x2a);
      if (isTiff) {
        const UTIF = (await import("utif")).default;
        const ifds = UTIF.decode(buf); UTIF.decodeImage(buf, ifds[0]);
        const rgba = UTIF.toRGBA8(ifds[0]);
        const c = document.createElement("canvas"); c.width = ifds[0].width; c.height = ifds[0].height;
        const px = new Uint8ClampedArray(rgba.length); px.set(rgba);
        c.getContext("2d")!.putImageData(new ImageData(px, c.width, c.height), 0, 0);
        setSrc(c.toDataURL("image/png"));
      } else {
        const heic2any = (await import("heic2any")).default;
        const out = await heic2any({ blob: new Blob([buf]), toType: "image/jpeg", quality: 0.92 });
        setSrc(URL.createObjectURL(Array.isArray(out) ? out[0] : out));
      }
      setState("ok");
    } catch { setState("failed"); }
  }

  const reset = () => { setZoom(1); setPos({ x: 0, y: 0 }); setRot(0); };
  useEffect(() => { reset(); setSrc(url); tried.current = false; setState("ok"); }, [url]);

  if (source !== null) return (
    <div className="h-full flex flex-col"><div className="px-3 py-2 border-b border-line"><button onClick={() => setSource(null)} className="min-h-[36px] px-3 rounded-md text-[12.5px] text-brand hover:bg-tint">← Back to image</button></div><div className="flex-1 min-h-0"><TextView text={source} /></div></div>
  );
  return (
    <div className="flex flex-col h-full min-h-0 bg-soft">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-line bg-surface shrink-0 text-[12.5px]">
        <button onClick={() => setZoom((z) => Math.max(0.1, +(z / 1.25).toFixed(3)))} aria-label="Zoom out" className="size-9 grid place-items-center rounded-md hover:bg-tint"><Minus size={15} /></button>
        <span className="w-12 text-center tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(8, +(z * 1.25).toFixed(3)))} aria-label="Zoom in" className="size-9 grid place-items-center rounded-md hover:bg-tint"><Plus size={15} /></button>
        <button onClick={reset} aria-label="Fit to window" title="Fit" className="size-9 grid place-items-center rounded-md hover:bg-tint"><Maximize size={15} /></button>
        <button onClick={() => setRot((r) => (r + 90) % 360)} aria-label="Rotate" className="size-9 grid place-items-center rounded-md hover:bg-tint"><RotateCw size={15} /></button>
        <span className="flex-1" />
        {natural && <span className="text-muted tabular-nums">{natural.w} × {natural.h}px</span>}
        {isSvg && <button onClick={async () => setSource(await fetch(bytesUrl).then((r) => r.text()))} className="min-h-[36px] px-2 rounded-md flex items-center gap-1 hover:bg-tint"><Code2 size={14} /> Source</button>}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden grid place-items-center select-none touch-none cursor-grab active:cursor-grabbing"
        style={{ backgroundImage: "conic-gradient(var(--line) 25%, transparent 0 50%, var(--line) 0 75%, transparent 0)", backgroundSize: "16px 16px" }}
        onWheel={(e) => { e.preventDefault(); setZoom((z) => Math.min(8, Math.max(0.1, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))); }}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; }}
        onPointerMove={(e) => { if (drag.current) setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y }); }}
        onPointerUp={() => { drag.current = null; }} onDoubleClick={() => (zoom === 1 ? setZoom(2) : reset())}>
        {state === "decoding" && <p className="text-[13px] text-muted bg-surface px-3 py-2 rounded-md">Converting this format for display…</p>}
        {state === "failed" && <p className="text-[13.5px] text-muted bg-surface px-4 py-3 rounded-md">This image format can’t be displayed in the browser. Download it to open it.</p>}
        {state === "ok" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`Preview of ${name}`} draggable={false} onError={onError}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="max-w-[96%] max-h-[96%] object-contain"
            style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom}) rotate(${rot}deg)`, transition: drag.current ? "none" : "transform .12s ease-out" }} />
        )}
      </div>
    </div>
  );
}
