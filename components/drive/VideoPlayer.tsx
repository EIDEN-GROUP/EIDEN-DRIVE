"use client";
import { useEffect, useState } from "react";
import { Download, RefreshCw, Loader2, AlertTriangle, Gauge } from "lucide-react";
import { nativeVideo } from "./filetext";

// Video that refuses to stay black. Chain:
//  1. direct stream (works for MP4/WebM/Ogg/MOV everywhere),
//  2. Google's own transcoding embed (any format Google can preview — AVI, MKV,
//     WMV, FLV…), when we know the Drive file id,
//  3. in-browser conversion (ffmpeg.wasm, Storage-hosted files): converts to
//     MP4 locally and plays the result — nothing uploads anywhere.
// Caps are stated, never silent: >300 MB won't convert in a tab.
//
// Quality: Auto measures your real throughput once (first megabyte, timed) and
// picks High (direct) or Saver. High forces direct, Saver forces the lightest
// path (Drive preview, else convert). Choice persists; the badge always shows
// what you are actually watching and why.
const CONVERT_MAX = 300 * 1024 * 1024;

function useSpeedMbps(src: string): number | null | "measuring" {
  const [out, setOut] = useState<number | null | "measuring">("measuring");
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const t0 = performance.now();
        const ctl = new AbortController();
        const kill = setTimeout(() => ctl.abort(), 10000);
        const res = await fetch(src, { signal: ctl.signal });
        if (!res.ok || !res.body) throw new Error("probe failed");
        const rd = res.body.getReader();
        let got = 0;
        for (;;) {
          const { done, value } = await rd.read();
          if (value) got += value.length;
          if (done || got >= 1024 * 1024) break;
        }
        clearTimeout(kill);
        try { await rd.cancel(); } catch { /* ignore */ }
        const secs = Math.max((performance.now() - t0) / 1000, 0.05);
        const mbps = (got * 8) / secs / 1_000_000;
        if (!gone) setOut(mbps);
      } catch {
        const nav = (navigator as Navigator & { connection?: { downlink?: number } }).connection;
        if (!gone) setOut(typeof nav?.downlink === "number" && nav.downlink > 0 ? nav.downlink : null);
      }
    })();
    return () => { gone = true; };
  }, [src]);
  return out;
}

type QMode = "auto" | "high" | "saver";

export default function VideoPlayer({ src, fileName, googleId, size, canDownload, downloadHref }: {
  src: string; fileName: string; googleId?: string | null; size?: number;
  canDownload: boolean; downloadHref: string;
}) {
  const directOk = nativeVideo(fileName);
  const [mode, setMode] = useState<QMode>(() => {
    try { const v = localStorage.getItem("eiden-video-q"); return v === "high" || v === "saver" ? v : "auto"; }
    catch { return "auto"; }
  });
  const speed = useSpeedMbps(src);
  const [phase, setPhase] = useState<"direct" | "drive" | "convert-offer">(directOk ? "direct" : googleId ? "drive" : "convert-offer");
  const [stalls, setStalls] = useState(0);

  function pick(m: QMode) {
    setMode(m);
    try { localStorage.setItem("eiden-video-q", m); } catch { /* ignore */ }
    setStalls(0);
    if (m === "high") setPhase("direct");
    else if (m === "saver") setPhase(googleId ? "drive" : "convert-offer");
    else setPhase(directOk ? "direct" : googleId ? "drive" : "convert-offer");
  }

  // Stall detector: buffering twice on Auto surfaces a one-tap Saver switch —
  // but the call is the viewer's, never automatic. Original pixels stay default.
  function onStall() {
    setStalls((s) => s + 1);
  }
  const showSaverHint = stalls >= 2 && (phase === "direct" && !!googleId);

  const quality = phase === "drive" ? "Saver · Google transcode" : phase === "convert-offer" ? "Convert" : "Original · direct";
  const speedTxt = speed === "measuring" ? "measuring…" : typeof speed === "number" ? `${speed >= 10 ? Math.round(speed) : speed.toFixed(1)} Mbps` : "speed unknown";

  const bar = (
    <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] text-muted">
      <Gauge size={13} aria-hidden="true" />
      <span className="tabular-nums">{mode === "auto" ? `Auto · ${quality} · ${speedTxt}` : `${mode === "high" ? "High" : "Saver"} · ${speedTxt}`}</span>
      <span className="flex-1" />
      {(["auto", "high", "saver"] as QMode[]).map((m) => (
        <button key={m} onClick={() => pick(m)} aria-pressed={mode === m}
          className={`min-h-[32px] px-2 rounded capitalize ${mode === m ? "bg-tint text-brand font-medium" : "hover:bg-tint/60"}`}>{m}</button>
      ))}
    </div>
  );

  if (phase === "drive" && googleId) {
    return (
      <div>
        {bar}
        <iframe src={`https://drive.google.com/file/d/${googleId}/preview`} title={`Video ${fileName}`}
          className="w-full h-[min(66vh,720px)] border-0 bg-black" allow="autoplay; fullscreen" allowFullScreen />
        <p className="px-4 py-2 text-[12px] text-muted">Playing via Google's preview transcoding — original file untouched.</p>
      </div>
    );
  }
  if (phase === "convert-offer") {
    return <div>{bar}<ConvertOffer src={src} fileName={fileName} size={size} canDownload={canDownload} downloadHref={downloadHref} /></div>;
  }
  return (
    <div>
      {bar}
      <div className="relative bg-black">
        <video src={src} controls className="w-full max-h-[66vh] bg-black" preload="metadata"
          onError={() => setPhase(googleId ? "drive" : "convert-offer")}
          onWaiting={onStall} onStalled={onStall} />
        {showSaverHint && (
          <button onClick={() => pick("saver")}
            className="absolute bottom-14 left-1/2 -translate-x-1/2 min-h-[40px] px-4 rounded-full bg-surface/95 border border-line text-[13px] shadow-pop">
            Buffering? Switch to Saver
          </button>
        )}
      </div>
    </div>
  );
}

function ConvertOffer({ src, fileName, size, canDownload, downloadHref }: {
  src: string; fileName: string; size?: number; canDownload: boolean; downloadHref: string;
}) {
  const [st, setSt] = useState<{ step: "idle" | "loading" | "converting" | "done" | "error"; pct?: number; msg?: string; url?: string }>(
    { step: (size ?? 0) > CONVERT_MAX ? "error" : "idle", msg: (size ?? 0) > CONVERT_MAX ? "This file is over 300 MB — too big to convert inside a browser tab. Download it and play locally." : undefined });

  async function convert() {
    try {
      setSt({ step: "loading", pct: 0 });
      // Loaded from pinned CDN builds at runtime (never bundled): keeps the
      // app bundle small and conversion available only when actually needed.
      interface FFmpegInstance {
        on(ev: "progress", cb: (p: { progress: number }) => void): void;
        load(o: { coreURL: string; wasmURL: string }): Promise<void>;
        writeFile(name: string, data: unknown): Promise<void>;
        exec(args: string[]): Promise<void>;
        readFile(name: string): Promise<Uint8Array>;
        terminate(): void;
      }
      const FFMPEG_ESM: string = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/+esm";
      const FFUTIL_ESM: string = "https://unpkg.com/@ffmpeg/util@0.12.2/+esm";
      const FF = (await import(/* webpackIgnore: true */ FFMPEG_ESM)) as { FFmpeg: new () => FFmpegInstance };
      const { fetchFile } = (await import(/* webpackIgnore: true */ FFUTIL_ESM)) as { fetchFile: (f: unknown) => Promise<Uint8Array> };
      const ffmpeg = new FF.FFmpeg();
      ffmpeg.on("progress", ({ progress }) => setSt({ step: "converting", pct: Math.round(progress * 100) }));
      await ffmpeg.load({
        coreURL: "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js",
        wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm"
      });
      const res = await fetch(src);
      if (!res.ok) throw new Error("couldn't fetch the file for conversion");
      await ffmpeg.writeFile("in", await fetchFile(res));
      setSt({ step: "converting", pct: 0 });
      await ffmpeg.exec(["-i", "in", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "faststart", "out.mp4"]);
      const data = await ffmpeg.readFile("out.mp4");
      const url = URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" }));
      try { ffmpeg.terminate(); } catch { /* ignore */ }
      setSt({ step: "done", url });
    } catch (e) {
      setSt({ step: "error", msg: e instanceof Error ? e.message : "Conversion failed — download the file and play it locally." });
    }
  }

  if (st.step === "done" && st.url) {
    return (
      <div>
        <video src={st.url} controls autoPlay className="w-full max-h-[70vh] bg-black" preload="metadata" />
        <p className="px-4 py-2 text-[12px] text-muted">Converted in your browser to MP4 for playback — the stored file is unchanged.</p>
      </div>
    );
  }
  return (
    <div className="p-8 text-center max-w-md mx-auto">
      <AlertTriangle size={26} className="mx-auto text-muted" />
      <p className="mt-3 text-[14px] font-medium">This format doesn't play directly in browsers</p>
      <p className="mt-1 text-[13px] text-muted">Browsers decode MP4 / WebM / Ogg natively. “{fileName}” can be converted to MP4 right here — it takes a while for big files and never uploads anything.</p>
      {st.step === "error" ? (
        <p className="mt-3 text-[13px] text-danger">{st.msg}</p>
      ) : (
        <button onClick={convert} disabled={st.step !== "idle"}
          className="mt-4 min-h-[44px] px-5 rounded-md bg-brand text-white text-sm font-medium disabled:opacity-60 inline-flex items-center gap-2">
          {st.step === "idle" ? <><RefreshCw size={15} /> Convert & play</> : <><Loader2 size={15} className="animate-spin" /> {st.step === "loading" ? "Loading converter…" : `Converting… ${st.pct ?? 0}%`}</>}
        </button>
      )}
      {(st.step === "loading" || st.step === "converting") && (
        <div className="mt-3 h-2 rounded-full bg-tint overflow-hidden" role="progressbar" aria-valuenow={st.pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-brand transition-all" style={{ width: `${st.step === "loading" ? 5 : st.pct ?? 0}%` }} />
        </div>
      )}
      {canDownload && (
        <p className="mt-3"><a href={downloadHref} className="inline-flex min-h-[44px] items-center gap-1.5 text-[13px] text-brand font-medium"><Download size={14} /> or download the original</a></p>
      )}
    </div>
  );
}
