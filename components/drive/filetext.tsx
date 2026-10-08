"use client";

// Shared file-type helpers for the viewer + editor. One source of truth so
// "can I view/edit this?" answers the same everywhere.

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "heic", "heif",
  "tif", "tiff", "psd", "psb", "jp2", "j2k", "jpx", "jxr", "hdp", "wdp",
  "tga", "dds", "exr",
  "cr2", "cr3", "nef", "arw", "dng", "rw2", "orf", "pef", "srw", "raf",
  "ppm", "pgm", "pbm", "xbm", "cur", "pcx"]);
// Formats NO browser decodes directly (RAW photos, PSD, TIFF, EXR…): covers for
// these come from Google's server-side thumbnails, or in-browser decode for
// TIFF (utif) / HEIC (heic2any) on Storage files.
const NEEDS_HELP = new Set(["tif", "tiff", "psd", "psb", "jp2", "j2k", "jpx", "jxr", "hdp", "wdp",
  "tga", "dds", "exr", "cr2", "cr3", "nef", "arw", "dng", "rw2", "orf", "pef", "srw", "raf",
  "ppm", "pgm", "pbm", "xbm", "cur", "pcx", "heic", "heif"]);
// NOTE: RAW camera files (cr2, nef, arw, dng) intentionally excluded — browsers
// can't decode them, so they get the honest download fallback instead of a
// broken image icon.
// Full container list (Wikipedia "Video file format"): browsers natively decode
// only a few of these — the viewer falls back to Drive-preview transcoding or
// in-browser conversion for the rest. Never silently mislabel one as playable.
const VIDEO = new Set(["mp4", "m4v", "webm", "ogv", "ogg", "mov", "avi", "wmv", "flv", "f4v", "mkv", "mpg", "mpeg", "m2ts", "mts", "m2t", "ts", "wtv", "3gp", "3g2", "asf", "rm", "rmvb", "vob", "ogm", "divx", "xvid", "amv", "dav"]);
// Containers a <video> tag can actually decode without help (H.264/VP9/Theora + AAC/Vorbis/Opus inside).
const NATIVE_VIDEO = new Set(["mp4", "m4v", "webm", "ogv", "ogg"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba", "aiff", "aif", "mid", "midi"]);
const PDF = new Set(["pdf"]);
const TEXT_EDIT = new Set(["txt", "md", "markdown", "html", "htm", "css", "js", "ts", "tsx", "jsx", "json", "xml", "csv", "yml", "yaml", "toml", "sh", "py", "sql", "env", "log", "java", "c", "h", "cpp", "go", "rs", "php", "rb", "vue", "svelte"]);
// Everything a text editor would open. Unknown extensions are also sniffed (see viewer/sniff.ts).
const TEXT_VIEW = new Set([...TEXT_EDIT, "ini", "cfg", "conf", "properties", "gitignore", "dockerfile", "makefile", "bat", "ps1", "zsh", "bash",
  "kt", "kts", "swift", "m", "mm", "cs", "scala", "lua", "pl", "r", "dart", "hs", "ex", "exs", "clj", "erl", "jl", "tex", "bib", "rst", "adoc", "org",
  "scss", "sass", "less", "styl", "graphql", "gql", "proto", "tf", "hcl", "gradle", "lock", "sub", "srt", "vtt", "ass", "ssa", "diff", "patch",
  "ics", "vcf", "eml", "ndjson", "jsonl", "svg", "plist", "tsv", "mjs", "cjs", "map", "asm", "s", "vb", "fs", "sol", "wat"]);
const CSV = new Set(["csv", "tsv"]);
const JSONK = new Set(["json", "jsonc", "geojson", "webmanifest", "har"]);
const DOCX = new Set(["docx", "docm", "dotx"]);
const SHEET = new Set(["xlsx", "xlsm", "xlsb", "xls", "ods", "fods", "numbers"]);
const SLIDES = new Set(["pptx", "ppsx", "potx", "pptm"]);
const ODF = new Set(["odt", "odp", "ott", "otp"]);
const ARCHIVE = new Set(["zip", "jar", "war", "apk", "ipa", "xpi", "crx", "tar", "tgz", "gz", "bz2", "xz", "7z", "rar", "cbz", "whl", "nupkg", "vsix"]);
const FONT = new Set(["ttf", "otf", "woff", "woff2"]);
const LEGACY = new Set(["doc", "dot", "ppt", "pps", "pot", "msg", "wps", "wpd", "pages", "key", "mdb", "pub", "vsd"]);
const EBOOK = new Set(["epub"]);

export type ViewKind =
  | "image" | "video" | "audio" | "pdf" | "markdown" | "html" | "code"
  | "csv" | "json" | "notebook" | "docx" | "sheet" | "slides" | "odf" | "archive" | "ebook" | "font" | "rtf" | "legacy"
  | "office" | "unknown";

export function nativeVideo(name: string, mime?: string): boolean {
  const e = extOf(name);
  if (NATIVE_VIDEO.has(e)) return true;
  // .mov usually holds H.264 (plays in Safari/Chrome); anything else misleading
  // is resolved at runtime: the player falls back on actual decode failure.
  if (e === "mov") return true;
  if (mime?.startsWith("video/") && (mime.includes("mp4") || mime.includes("webm") || mime.includes("ogg"))) return true;
  return false;
}

// True when no <img>/<video> tag can show this file directly (RAW, PSD, TIFF,
// EXR, exotic video…). Covers for these must come from Google thumbs or decode.
export function needsHelp(name: string, mime?: string): boolean {
  const e = extOf(name);
  if (NEEDS_HELP.has(e)) return true;
  if (mime && /^image\/(x-(canon|nikon|minolta|sony|fuji|olympus|pentax|samsung)-|x-dcraw|vnd\.adobe\.photoshop)/i.test(mime)) return true;
  return false;
}

// Google file id for any row shape (indexed column, or live g:[account:]id).
export function googleIdOf(id: string, col?: string | null): string | null {
  if (col) return col;
  if (!id.startsWith("g:")) return null;
  const rest = id.slice(2);
  const i = rest.indexOf(":");
  return (i >= 0 ? rest.slice(i + 1) : rest) || null;
}

export function viewKind(name: string, mime?: string): ViewKind {
  const e = extOf(name);
  const lower = name.toLowerCase();
  if (e === "svg") return "image"; // rendered as an <img> (scripts never run); source is one click away
  if (IMAGE.has(e) || mime?.startsWith("image/")) return "image";
  if (VIDEO.has(e) || mime?.startsWith("video/")) return "video";
  if (AUDIO.has(e) || mime?.startsWith("audio/")) return "audio";
  if (PDF.has(e) || mime === "application/pdf") return "pdf";
  if (e === "ipynb") return "notebook";
  if (e === "md" || e === "markdown" || e === "mdx" || mime === "text/markdown") return "markdown";
  if (e === "html" || e === "htm" || e === "xhtml") return "html";
  if (CSV.has(e) || mime === "text/csv" || mime === "text/tab-separated-values") return "csv";
  if (JSONK.has(e) || mime === "application/json") return "json";
  if (e === "rtf" || mime === "application/rtf" || mime === "text/rtf") return "rtf";
  if (DOCX.has(e)) return "docx";
  if (SHEET.has(e)) return "sheet";
  if (SLIDES.has(e)) return "slides";
  if (ODF.has(e)) return "odf";
  if (EBOOK.has(e)) return "ebook";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tar.bz2") || lower.endsWith(".tar.xz") || ARCHIVE.has(e)) return "archive";
  if (FONT.has(e)) return "font";
  if (LEGACY.has(e)) return "legacy";
  if (TEXT_VIEW.has(e) || mime?.startsWith("text/") || mime === "application/xml" || mime === "application/x-sh" || mime === "application/javascript") return "code";
  if (["cfg", "ini"].includes(e)) return "code";
  return "unknown";
}

export function editable(name: string, mime?: string): boolean {
  return TEXT_EDIT.has(extOf(name));
}

export function langOf(name: string): string {
  const e = extOf(name);
  const map: Record<string, string> = {
    js: "JavaScript", jsx: "JSX", ts: "TypeScript", tsx: "TSX", json: "JSON",
    html: "HTML", htm: "HTML", css: "CSS", md: "Markdown", markdown: "Markdown",
    py: "Python", sh: "Shell", sql: "SQL", xml: "XML", yml: "YAML", yaml: "YAML",
    toml: "TOML", txt: "Plain text", log: "Log", csv: "CSV", env: "Env",
    java: "Java", c: "C", h: "C Header", cpp: "C++", go: "Go", rs: "Rust",
    php: "PHP", rb: "Ruby", vue: "Vue", svelte: "Svelte"
  };
  return map[e] ?? e.toUpperCase();
}

export function escHtml(s: string): string {
  // Quotes too: escHtml output is later placed inside attributes (links), so " must never survive.
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Minimal Markdown → HTML (escaped first, so raw HTML in the doc never executes).
export function mdToHtml(src: string): string {
  const lines = src.split("\n");
  let html = "", inCode = false, inList: string | null = null, para: string[] = [];
  const inline = (t: string) => escHtml(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const flush = () => {
    if (para.length) { html += `<p>${para.map(inline).join("<br>")}</p>`; para = []; }
    if (inList) { html += inList === "ul" ? "</ul>" : "</ol>"; inList = null; }
  };
  for (const line of lines) {
    if (/^```/.test(line)) {
      flush();
      inCode = !inCode;
      html += inCode ? "<pre><code>" : "</code></pre>";
      continue;
    }
    if (inCode) { html += escHtml(line) + "\n"; continue; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
      flush();
      const lvl = m[1].length;
      html += `<h${lvl}>${inline(m[2])}</h${lvl}>`;
    } else if (/^\s*---+\s*$/.test(line)) { flush(); html += "<hr>"; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      if (inList !== "ul") { if (inList) html += "</ol>"; html += "<ul>"; inList = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (inList !== "ol") { if (inList) html += "</ul>"; html += "<ol>"; inList = "ol"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if (/^\s*$/.test(line)) flush();
    else para.push(line);
  }
  flush();
  return html;
}

// Tiny per-language highlighter: comments, strings, numbers, keywords.
// Not a full grammar — honest scope, but reads like an editor for real code.
const KEYWORDS = new Set(("const let var function return if else for while do switch case break continue new class extends import export from default try catch finally throw async await true false null undefined this typeof instanceof in of void delete with static get set constructor super yield keyof interface type enum implements abstract readonly as is satisfies").split(" "));
export function highlight(code: string): string {
  const out: string[] = [];
  let i = 0;
  const push = (cls: string | null, s: string) => out.push(cls ? `<span class="tok-${cls}">${escHtml(s)}</span>` : escHtml(s));
  while (i < code.length) {
    const c = code[i];
    if (c === "/" && code[i + 1] === "/") {
      const j = code.indexOf("\n", i);
      push("com", code.slice(i, j < 0 ? undefined : j));
      i = j < 0 ? code.length : j;
    } else if (c === "/" && code[i + 1] === "*") {
      const j = code.indexOf("*/", i + 2);
      push("com", code.slice(i, j < 0 ? undefined : j + 2));
      i = j < 0 ? code.length : j + 2;
    } else if (c === "#" && (i === 0 || code[i - 1] === "\n")) {
      const j = code.indexOf("\n", i);
      push("com", code.slice(i, j < 0 ? undefined : j));
      i = j < 0 ? code.length : j;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== c) { if (code[j] === "\\") j++; j++; }
      push("str", code.slice(i, j + 1));
      i = j + 1;
    } else if (/\d/.test(c) && (i === 0 || /[\s(=,:\[{]/.test(code[i - 1]))) {
      const m = code.slice(i).match(/^\d[\w.]*/);
      push("num", m![0]);
      i += m![0].length;
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = code.slice(i).match(/^[A-Za-z_$][\w$]*/);
      const w = m![0];
      push(KEYWORDS.has(w) ? "kw" : null, w);
      i += w.length;
    } else { push(null, c); i++; }
  }
  return out.join("");
}
