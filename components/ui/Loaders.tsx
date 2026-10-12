"use client";
import { useId } from "react";
import { Check, AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";
import { FileIcon } from "./Glyphs";
import { formatBytes } from "@/lib/files";

/* ── Loader library ────────────────────────────────────────────────
 * Ring + Dots: vendored from loading-ui (turbostarter/loading-ui, free and
 * open source) — adapted to zero deps (no cn/clsx), keyframes injected
 * inline following the upstream pattern so nothing global is needed.
 * SparkleLoader: the Uiverse sparkle (andrew-manzyk) the user picked for
 * refresh/wait states — React-ified with collision-free SVG ids.
 * UploadPanel: Google-Drive-style bottom-right upload card.
 * All loaders use currentColor (or the brand var) and honor
 * prefers-reduced-motion.
 * ────────────────────────────────────────────────────────────────── */

/** Ring spinner (loading-ui `ring`): SVG arc, currentColor, size via className. */
export function Ring({ className = "size-4", style, label }: { className?: string; style?: React.CSSProperties; label?: string }) {
  return (
    <>
      <style>{`@keyframes eiden-ring-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .eiden-ring { animation-duration: 3s; } }`}</style>
      <svg
        viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
        role={label ? "status" : undefined} aria-label={label}
        className={`eiden-ring ${className}`}
        style={{
          animationName: "eiden-ring-spin",
          animationDuration: "var(--duration, 0.9s)",
          animationTimingFunction: "linear",
          animationIterationCount: "infinite",
          ...style,
        }}
      >
        <path
          d="M21 12.0004C20.9999 13.901 20.3981 15.7528 19.2809 17.2904C18.1637 18.8279 16.5885 19.9723 14.7809 20.5596C12.9733 21.1469 11.0262 21.1468 9.21864 20.5594C7.41109 19.9721 5.83588 18.8276 4.71876 17.29C3.60165 15.7523 2.99999 13.9005 3 11.9999C3.00001 10.0993 3.60171 8.24755 4.71884 6.70994C5.83598 5.17233 7.4112 4.02785 9.21877 3.44052C11.0263 2.85319 12.9734 2.85316 14.781 3.44044"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    </>
  );
}

/** Typing dots (loading-ui `dots`): staggered blink, width-driven scale. */
export function Dots({ className = "w-10", dots = 3, label = "Loading" }: { className?: string; dots?: number; label?: string }) {
  return (
    <>
      <style>{`@keyframes eiden-dots-blink { 0%, 100% { opacity: 0.2; } 20% { opacity: 1; } }`}</style>
      <span role="status" className={`inline-flex items-center justify-center gap-[12%] ${className}`}>
        {Array.from({ length: dots }, (_, i) => (
          <span
            key={i} aria-hidden="true"
            style={{
              animation: "eiden-dots-blink var(--duration, 1.4s) infinite both",
              animationDelay: `calc(var(--delay, 0.2s) * ${i})`,
            }}
            className="aspect-square grow rounded-full bg-current"
          />
        ))}
        <span className="sr-only">{label}</span>
      </span>
    </>
  );
}

const SPARK_D = "M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z";

function SparklePeg({ p, cls, delay }: { p: string; cls: string; delay: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true" className={cls} style={{ animationDelay: delay }}>
      <defs>
        <filter id={`${p}-shine`}><feGaussianBlur stdDeviation="3" /></filter>
        <mask id={`${p}-mask`}><path d={SPARK_D} fill="white" /></mask>
        <radialGradient id={`${p}-g1`} cx="50" cy="66" fx="50" fy="66" r="30" gradientTransform="translate(0 35) scale(1 0.5)" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="black" stopOpacity="0.3" /><stop offset="50%" stopColor="black" stopOpacity="0.1" /><stop offset="100%" stopColor="black" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${p}-g2`} cx="55" cy="20" fx="55" fy="20" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="white" stopOpacity="0.3" /><stop offset="50%" stopColor="white" stopOpacity="0.1" /><stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${p}-g3`} cx="85" cy="50" fx="85" fy="50" xlinkHref={`#${p}-g2`} />
        <radialGradient id={`${p}-g4`} cx="50" cy="58" fx="50" fy="58" r="60" gradientTransform="translate(0 47) scale(1 0.2)" xlinkHref={`#${p}-g3`} />
        <linearGradient id={`${p}-g5`} x1="50" y1="90" x2="50" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="black" stopOpacity="0.2" /><stop offset="40%" stopColor="black" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g>
        <path d={SPARK_D} fill="currentColor" />
        <path d={SPARK_D} fill={`url(#${p}-g1)`} />
        <path d={SPARK_D} fill="none" stroke="white" opacity="0.3" strokeWidth="3" filter={`url(#${p}-shine)`} mask={`url(#${p}-mask)`} />
        <path d={SPARK_D} fill={`url(#${p}-g2)`} />
        <path d={SPARK_D} fill={`url(#${p}-g3)`} />
        <path d={SPARK_D} fill={`url(#${p}-g4)`} />
        <path d={SPARK_D} fill={`url(#${p}-g5)`} />
      </g>
    </svg>
  );
}

/** Brand sparkle wait-state (Uiverse pegtop flow): for refresh / full-view loads. */
export function SparkleLoader({ size = 72, label = "Loading", className = "" }: { size?: number; label?: string; className?: string }) {
  const uid = useId().replace(/:/g, "");
  return (
    <>
      <style>{`
.eiden-sparkle { --fill-color: #5b3fd0; --shine-color: #5c3d9933; position: relative; filter: drop-shadow(0 0 10px var(--shine-color)); color: var(--fill-color); }
.eiden-sparkle svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.eiden-sparkle .peg-one { animation: eiden-flowe-one 1s linear infinite; }
.eiden-sparkle .peg-two { opacity: 0; transform: scale(0) translateY(-200px) translateX(-100px); animation: eiden-flowe-two 1s linear infinite; }
.eiden-sparkle .peg-three { opacity: 0; transform: scale(0) translateY(-200px) translateX(100px); animation: eiden-flowe-three 1s linear infinite; }
@keyframes eiden-flowe-one {
  0% { transform: scale(0.5) translateY(-200px); opacity: 0; }
  25% { transform: scale(0.75) translateY(-100px); opacity: 1; }
  50% { transform: scale(1) translateY(0px); opacity: 1; }
  75% { transform: scale(0.5) translateY(50px); opacity: 1; }
  100% { transform: scale(0) translateY(100px); opacity: 0; }
}
@keyframes eiden-flowe-two {
  0% { transform: scale(0.5) rotate(-10deg) translateY(-200px) translateX(-100px); opacity: 0; }
  25% { transform: scale(1) rotate(-5deg) translateY(-100px) translateX(-50px); opacity: 1; }
  50% { transform: scale(1) rotate(0deg) translateY(0px) translateX(-25px); opacity: 1; }
  75% { transform: scale(0.5) rotate(5deg) translateY(50px) translateX(0px); opacity: 1; }
  100% { transform: scale(0) rotate(10deg) translateY(100px) translateX(25px); opacity: 0; }
}
@keyframes eiden-flowe-three {
  0% { transform: scale(0.5) rotate(10deg) translateY(-200px) translateX(100px); opacity: 0; }
  25% { transform: scale(1) rotate(5deg) translateY(-100px) translateX(50px); opacity: 1; }
  50% { transform: scale(1) rotate(0deg) translateY(0px) translateX(25px); opacity: 1; }
  75% { transform: scale(0.5) rotate(-5deg) translateY(50px) translateX(0px); opacity: 1; }
  100% { transform: scale(0) rotate(-10deg) translateY(100px) translateX(-25px); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .eiden-sparkle .peg-one { animation: none; opacity: 1; transform: none; }
  .eiden-sparkle .peg-two, .eiden-sparkle .peg-three { display: none; }
}`}</style>
      <div className={`eiden-sparkle ${className}`} role="status" aria-label={label} style={{ width: size, height: size }}>
        <SparklePeg p={`${uid}a`} cls="peg-one" delay="0s" />
        <SparklePeg p={`${uid}b`} cls="peg-two" delay="0.3s" />
        <SparklePeg p={`${uid}c`} cls="peg-three" delay="0.6s" />
        <span className="sr-only">{label}</span>
      </div>
    </>
  );
}

/* ── Upload panel ─────────────────────────────────────────────────── */

export type UploadStatus = "hashing" | "uploading" | "indexing" | "done" | "error";
export interface UploadItem {
  key: number; name: string; size: number; mime?: string;
  status: UploadStatus; pct: number | null; error?: string; dest: string;
}

function statusLine(it: UploadItem): string {
  if (it.status === "hashing") return "Preparing…";
  if (it.status === "uploading") return it.pct == null ? "Starting upload…" : `Uploading… ${Math.round(it.pct)}%`;
  if (it.status === "indexing") return "Finishing…";
  if (it.status === "done") return "Uploaded";
  return it.error ?? "Upload failed";
}

/** Google-Drive-style bottom-right upload card. */
export function UploadPanel({ items, minimized, onToggleMin, onDismiss, onCancel }: {
  items: UploadItem[]; minimized: boolean;
  onToggleMin: () => void; onDismiss: () => void; onCancel: () => void;
}) {
  if (!items.length) return null;
  const active = items.filter((i) => i.status === "hashing" || i.status === "uploading" || i.status === "indexing");
  const done = items.length - active.length;
  const failed = items.filter((i) => i.status === "error").length;
  const title = active.length
    ? `Uploading ${active.length} item${active.length === 1 ? "" : "s"}`
    : failed === items.length ? "Uploads failed" : `${done} upload${done === 1 ? "" : "s"} complete`;
  return (
    <>
      <style>{`@keyframes eiden-panel-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes eiden-bar-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
.eiden-panel-in { animation: eiden-panel-in 0.22s ease-out; }
.eiden-bar-ind { animation: eiden-bar-slide 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .eiden-panel-in, .eiden-bar-ind { animation: none; } }`}</style>
      <section aria-label="Uploads" className="eiden-panel-in fixed bottom-4 right-4 z-[80] w-[min(92vw,360px)] rounded-xl border border-line bg-surface shadow-pop overflow-hidden">
        <header className="flex items-center gap-2 pl-4 pr-2 min-h-[52px] bg-tint/50">
          <p className="flex-1 text-[13.5px] font-medium truncate" role="status">{title}</p>
          {active.length > 0 && (
            <button onClick={onCancel} className="min-h-[36px] px-2 text-[12.5px] text-brand font-medium hover:underline">Cancel</button>
          )}
          <button onClick={onToggleMin} aria-label={minimized ? "Expand upload panel" : "Minimize upload panel"}
            className="size-9 grid place-items-center rounded-md hover:bg-tint text-muted">
            {minimized ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          <button onClick={onDismiss} disabled={active.length > 0} aria-label="Dismiss upload panel" title={active.length > 0 ? "Wait for uploads to finish" : "Dismiss"}
            className="size-9 grid place-items-center rounded-md hover:bg-tint text-muted disabled:opacity-40">
            <X size={17} />
          </button>
        </header>
        {!minimized && (
          <ul className="max-h-64 overflow-y-auto divide-y divide-line/70">
            {items.map((it) => (
              <li key={it.key} className="px-4 py-2.5 flex items-center gap-3">
                <span className="shrink-0 w-5 grid place-items-center" aria-hidden="true">
                  {it.status === "done"
                    ? <span className="size-5 rounded-full bg-[#22c32e] text-white grid place-items-center"><Check size={13} strokeWidth={3} /></span>
                    : it.status === "error"
                      ? <AlertTriangle size={16} className="text-danger" />
                      : <span className="text-brand"><Ring className="size-4" /></span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 min-w-0">
                    <FileIcon name={it.name} mime={it.mime} folder={false} size={18} className="shrink-0" />
                    <span className="truncate text-[13px]" title={it.name}>{it.name}</span>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-muted truncate">
                    {statusLine(it)} · {formatBytes(it.size)}{it.dest ? ` · ${it.dest}` : ""}
                  </span>
                  {(it.status === "uploading" || it.status === "indexing") && (
                    <span className="mt-1.5 block h-1 rounded-full bg-tint overflow-hidden" aria-hidden="true">
                      {it.pct == null || it.status === "indexing"
                        ? <span className="eiden-bar-ind block h-full w-2/5 rounded-full bg-brand" />
                        : <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.round(it.pct)}%` }} />}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
