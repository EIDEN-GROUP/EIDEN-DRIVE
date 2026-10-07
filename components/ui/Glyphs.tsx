import { extOf, viewKind, type ViewKind } from "../drive/filetext";

// File & folder icons. Files are paper pages with a folded corner and a coloured type label (PNG, PDF, DOCX…),
// each type with its own accent and a small symbol — recognisable at a glance, like a desktop file manager.
// Small sizes (< 44 px) drop the letters and keep the accent bar so the icon stays crisp.

export type Kind = "folder" | "image" | "doc" | "video" | "file";

/** Legacy mapping kept for callers that only have the coarse Explorer class. */
export function kindOf(classified: string, isFolder = false): Kind {
  if (isFolder) return "folder";
  if (classified === "IMAGE" || classified === "DESIGN") return "image";
  if (classified === "VIDEO") return "video";
  if (["PDF", "DOCX", "XLSX", "PPTX", "HTML"].includes(classified)) return "doc";
  return "file";
}

type Glyph = "image" | "video" | "audio" | "lines" | "grid" | "slides" | "zip" | "code" | "font" | "book" | "data";
interface FT { label: string; color: string; glyph: Glyph }

const COLORS = { image: "#0ea5e9", video: "#8b5cf6", audio: "#ec4899", pdf: "#e5322d", word: "#2563eb", sheet: "#16a34a", slides: "#f97316", archive: "#a16207", code: "#0f766e", font: "#7c3aed", book: "#b45309", other: "#64748b" };

export function fileType(name: string, mime?: string): FT {
  const ext = extOf(name);
  const k: ViewKind = viewKind(name, mime);
  const raw = ext === "markdown" ? "md" : ext === "jpeg" ? "jpg" : ext;
  const label = (raw || "file").toUpperCase().slice(0, 4);
  switch (k) {
    case "image": return { label, color: COLORS.image, glyph: "image" };
    case "video": return { label, color: COLORS.video, glyph: "video" };
    case "audio": return { label, color: COLORS.audio, glyph: "audio" };
    case "pdf": return { label: "PDF", color: COLORS.pdf, glyph: "lines" };
    case "docx": case "odf": case "rtf": case "legacy": return { label: ["ppt", "pps", "odp"].includes(ext) ? label : label, color: ["ppt", "pps", "pot", "odp", "otp"].includes(ext) ? COLORS.slides : COLORS.word, glyph: ["ppt", "pps", "pot", "odp", "otp"].includes(ext) ? "slides" : "lines" };
    case "sheet": case "csv": return { label, color: COLORS.sheet, glyph: "grid" };
    case "slides": return { label, color: COLORS.slides, glyph: "slides" };
    case "archive": return { label, color: COLORS.archive, glyph: "zip" };
    case "ebook": return { label, color: COLORS.book, glyph: "book" };
    case "font": return { label, color: COLORS.font, glyph: "font" };
    case "json": case "notebook": return { label, color: COLORS.code, glyph: "data" };
    case "markdown": case "html": case "code":
      return ["txt", "text", "log", "ini", "cfg", "conf", "srt", "vtt"].includes(ext) ? { label, color: COLORS.other, glyph: "lines" } : { label, color: COLORS.code, glyph: "code" };
    default: return { label, color: COLORS.other, glyph: "lines" };
  }
}

function GlyphArt({ g, c }: { g: Glyph; c: string }) {
  const sw = { stroke: c, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (g) {
    case "image": return <><rect x="12" y="19" width="22" height="16" rx="3" fill={c} opacity=".14" /><circle cx="19" cy="25" r="2.2" fill={c} /><path d="M13.5 34 20 27.5l4.2 4.2 3.3-3.3 6 5.6z" fill={c} /></>;
    case "video": return <><rect x="12" y="19" width="22" height="16" rx="3.5" fill={c} opacity=".16" /><path d="M20.5 23.5 29 27l-8.5 3.5z" fill={c} /></>;
    case "audio": return <><path d="M22 31V21l9-2.4v9.6" {...sw} /><circle cx="19.5" cy="31.5" r="3" fill={c} /><circle cx="28.5" cy="28.5" r="3" fill={c} /></>;
    case "grid": return <><rect x="12" y="19" width="22" height="16" rx="2.5" {...sw} strokeWidth={1.6} /><path d="M12 24.3h22M12 29.6h22M19.3 19v16M26.7 19v16" {...sw} strokeWidth={1.4} opacity=".7" /></>;
    case "slides": return <><rect x="12" y="19" width="22" height="16" rx="2.5" {...sw} strokeWidth={1.6} /><path d="M17 31v-4M23 31v-8M29 31v-6" {...sw} strokeWidth={2.4} /></>;
    case "zip": return <><path d="M23 18v18" {...sw} strokeWidth={1.4} opacity=".5" /><rect x="20.5" y="21" width="5" height="3.6" rx="1" fill={c} /><rect x="20.5" y="27" width="5" height="3.6" rx="1" fill={c} /><rect x="20.5" y="33" width="5" height="3" rx="1" fill={c} opacity=".8" /></>;
    case "code": return <path d="M19.5 22.5 13.5 27.5l6 5M26.5 22.5l6 5-6 5" {...sw} />;
    case "data": return <path d="M19 20.5c-3 0-3 2-3 4s-1.5 3-3 3c1.5 0 3 1 3 3s0 4 3 4M27 20.5c3 0 3 2 3 4s1.5 3 3 3c-1.5 0-3 1-3 3s0 4-3 4" {...sw} strokeWidth={1.8} />;
    case "font": return <text x="23" y="34" textAnchor="middle" fontSize="16" fontWeight="700" fontFamily="Georgia, serif" fill={c}>Aa</text>;
    case "book": return <><path d="M13 20.5c4-1.5 7-1 10 1.2 3-2.2 6-2.7 10-1.2v14c-4-1.5-7-1-10 1.2-3-2.2-6-2.7-10-1.2z" {...sw} strokeWidth={1.6} /><path d="M23 21.7V35.5" {...sw} strokeWidth={1.4} /></>;
    default: return <path d="M14 23h18M14 28h18M14 33h11" {...sw} strokeWidth={2.2} />;
  }
}

/** The page icon. `size` is the height in px; width follows the 46×58 page proportion. */
export function FileIcon({ name, mime, folder = false, size = 24, className = "" }: { name: string; mime?: string; folder?: boolean; size?: number; className?: string }) {
  if (folder) return <FolderIcon size={size} className={className} />;
  const t = fileType(name, mime);
  const showArt = size >= 28, showText = size >= 44;
  return (
    <svg width={Math.round(size * 0.79)} height={size} viewBox="0 0 46 58" className={className} aria-hidden="true" style={{ filter: size >= 20 ? "drop-shadow(0 1px 1.5px rgba(30,20,80,.22))" : undefined }}>
      <defs>
        <linearGradient id="fi-pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#ebebf0" /></linearGradient>
        <linearGradient id="fi-fold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#d9d9e2" /></linearGradient>
      </defs>
      <path d="M7 2H28L43 17V52a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z" fill="url(#fi-pg)" stroke="#d6d6df" strokeWidth=".8" />
      <path d="M28 2V13a4 4 0 0 0 4 4H43Z" fill="url(#fi-fold)" stroke="#d0d0da" strokeWidth=".8" strokeLinejoin="round" />
      {showArt && <GlyphArt g={t.glyph} c={t.color} />}
      {showText
        ? <><rect x="8" y="40.5" width="30" height="10.5" rx="3" fill={t.color} /><text x="23" y="48.4" textAnchor="middle" fontSize={t.label.length > 3 ? 6.4 : 7.4} fontWeight="700" fill="#fff" fontFamily="Poppins, system-ui, sans-serif" letterSpacing=".3">{t.label}</text></>
        : <rect x="9" y={showArt ? 43 : 41} width="28" height={showArt ? 6.5 : 8} rx="2.4" fill={t.color} />}
    </svg>
  );
}

/** Folder: deep back panel + brighter front flap with a soft top highlight. */
export function FolderIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={Math.round(size * 1.15)} height={size} viewBox="0 0 48 42" className={className} aria-hidden="true" style={{ filter: size >= 20 ? "drop-shadow(0 1px 1.5px rgba(30,20,80,.25))" : undefined }}>
      <defs>
        <linearGradient id="fo-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: "color-mix(in srgb, var(--icon) 72%, #fff)" }} /><stop offset="1" style={{ stopColor: "var(--icon)" }} /></linearGradient>
      </defs>
      <path d="M3 8a4 4 0 0 1 4-4h11.5l4.5 4.5H41a4 4 0 0 1 4 4V34a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" style={{ fill: "color-mix(in srgb, var(--icon) 70%, #000)" }} />
      <path d="M3 17a4 4 0 0 1 4-4h34a4 4 0 0 1 4 4V34a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" fill="url(#fo-front)" />
      <path d="M7 13.6h34" stroke="#fff" strokeOpacity=".35" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Back-compat wrapper (kind-only callers). Prefer <FileIcon name=… />. */
export function FileGlyph({ kind, size = 22, className = "" }: { kind: Kind; size?: number; className?: string }) {
  if (kind === "folder") return <FolderIcon size={size} className={className} />;
  const probe = kind === "image" ? "x.png" : kind === "video" ? "x.mp4" : kind === "doc" ? "x.docx" : "x.file";
  return <FileIcon name={probe} size={size} className={className} />;
}
