"use client";
import DOMPurify from "dompurify";

// ── HTML sanitising (docx / markdown / notebooks / epub). Scripts, styles, forms, frames, handlers: gone. ──
let hooked = false;
export function sanitizeHtml(html: string): string {
  // <input type=checkbox> (GFM task lists) is forbidden by the sanitiser — keep the meaning as a glyph.
  html = html.replace(/<input[^>]*type="checkbox"[^>]*>/gi, (m) => (/checked/i.test(m) ? '<span class="task">☑</span>' : '<span class="task">☐</span>'));
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      // Only pictures embedded in the document may load. A remote <img> would "phone home" (tracking pixel) when opened.
      if (node instanceof Element && node.tagName === "IMG" && !/^(data:|blob:)/i.test(node.getAttribute("src") ?? "")) node.remove();
      if (node instanceof Element && node.tagName === "A") {
        const href = node.getAttribute("href") ?? "";
        if (/^https?:/i.test(href)) { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer nofollow"); }
        else if (!href.startsWith("#")) node.removeAttribute("href"); // no javascript:, data:, file: …
      }
    });
  }
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "frame", "object", "embed", "link", "meta", "base", "script"],
    FORBID_ATTR: ["style", "srcset", "formaction"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,|blob:|#)/i
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function fmtBytes(n?: number | null): string {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB"]; let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

// ── Text decoding ──
export function decodeText(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder("utf-8").decode(b.subarray(3));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); }
  catch { return new TextDecoder("windows-1252").decode(b); } // legacy single-byte text (old CSVs, logs…)
}

/** Heuristic: no NUL bytes and mostly printable → treat as text. */
export function looksLikeText(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 8192));
  if (b.length === 0) return true;
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return true; // UTF-16 BOM
  let bad = 0;
  for (const c of b) { if (c === 0) return false; if (c < 9 || (c > 13 && c < 32)) bad++; }
  return bad / b.length < 0.02;
}

// ── Magic-number sniffing (for files with no / wrong extension) ──
export interface Sniff { label: string; kind?: "pdf" | "image" | "archive" | "sheet" | "legacy" | "audio" | "video" | "font" | "docx" | "slides" | "ebook" }
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0));
export function sniff(buf: ArrayBuffer): Sniff | null {
  const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 64));
  if (ascii(b, 0, "%PDF")) return { label: "PDF document", kind: "pdf" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return { label: "PNG image", kind: "image" };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { label: "JPEG image", kind: "image" };
  if (ascii(b, 0, "GIF8")) return { label: "GIF image", kind: "image" };
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return { label: "WebP image", kind: "image" };
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE")) return { label: "WAV audio", kind: "audio" };
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "AVI ")) return { label: "AVI video", kind: "video" };
  if (ascii(b, 4, "ftyp")) return { label: ascii(b, 8, "heic") || ascii(b, 8, "mif1") ? "HEIC image" : ascii(b, 8, "M4A ") ? "M4A audio" : "MP4 / QuickTime media", kind: ascii(b, 8, "heic") || ascii(b, 8, "mif1") ? "image" : "video" };
  if (startsWith(b, [0x49, 0x44, 0x33]) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { label: "MP3 audio", kind: "audio" };
  if (ascii(b, 0, "OggS")) return { label: "Ogg media", kind: "audio" };
  if (ascii(b, 0, "fLaC")) return { label: "FLAC audio", kind: "audio" };
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return { label: "Matroska / WebM video", kind: "video" };
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])) return { label: "ZIP-based file (zip / Office / epub …)", kind: "archive" };
  if (startsWith(b, [0x1f, 0x8b])) return { label: "gzip archive", kind: "archive" };
  if (ascii(b, 0, "7z") && b[2] === 0xbc) return { label: "7-Zip archive" };
  if (ascii(b, 0, "Rar!")) return { label: "RAR archive" };
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { label: "Microsoft Office 97–2003 file (doc / xls / ppt / msg)", kind: "legacy" };
  if (ascii(b, 0, "{\\rtf")) return { label: "Rich Text Format" };
  if (ascii(b, 0, "wOFF") || ascii(b, 0, "wOF2") || startsWith(b, [0, 1, 0, 0]) || ascii(b, 0, "OTTO")) return { label: "Font file", kind: "font" };
  if (ascii(b, 0, "SQLite format 3")) return { label: "SQLite database" };
  if (ascii(b, 0, "MZ")) return { label: "Windows executable" };
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return { label: "ELF executable" };
  return null;
}

// ── CSV ──
export function detectDelimiter(text: string): string {
  const head = text.slice(0, 4000).split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 5);
  let best = ",", score = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = head.map((l) => l.split(d).length - 1);
    const s = counts[0] > 0 && counts.every((c) => c === counts[0]) ? counts[0] * 10 : Math.min(...counts);
    if (s > score) { score = s; best = d; }
  }
  return best;
}
export function parseCsv(text: string, delim = detectDelimiter(text), maxRows = 100_000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// ── RTF → plain text (headings/tables/formatting are dropped, the words are kept) ──
export function rtfToText(rtf: string): string {
  const skip = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "footnote", "themedata", "colorschememapping", "latentstyles", "datastore", "xmlnstbl", "listtable", "listoverridetable", "rsidtbl", "generator"]);
  let out = "", i = 0, depth = 0;
  const skipDepths: number[] = [];
  while (i < rtf.length) {
    const c = rtf[i];
    if (c === "{") { depth++; i++; if (rtf[i] === "\\" && rtf[i + 1] === "*") { skipDepths.push(depth); } continue; }
    if (c === "}") { if (skipDepths[skipDepths.length - 1] === depth) skipDepths.pop(); depth--; i++; continue; }
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
      if (m) {
        i += m[0].length;
        if (skip.has(m[1]) && !skipDepths.includes(depth)) skipDepths.push(depth);
        if (skipDepths.length) continue;
        if (m[1] === "par" || m[1] === "line" || m[1] === "row") out += "\n";
        else if (m[1] === "tab" || m[1] === "cell") out += "\t";
        else if (m[1] === "u" && m[2]) { const n = parseInt(m[2], 10); out += String.fromCharCode(n < 0 ? n + 65536 : n); if (rtf[i] === "?") i++; }
        continue;
      }
      const h = /^\\'([0-9a-fA-F]{2})/.exec(rtf.slice(i, i + 4));
      if (h) { i += 4; if (!skipDepths.length) out += new TextDecoder("windows-1252").decode(new Uint8Array([parseInt(h[1], 16)])); continue; }
      i += 2; if (!skipDepths.length && /[\\{}]/.test(rtf[i - 1])) out += rtf[i - 1]; continue;
    }
    if (!skipDepths.length && c !== "\r" && c !== "\n") out += c;
    i++;
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// ── Strings extraction for opaque binaries / legacy Office (ASCII + UTF-16LE runs) ──
export function extractStrings(buf: ArrayBuffer, min = 5, cap = 2_000_000): string {
  const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 12_000_000));
  const found: string[] = [];
  let run = "", total = 0;
  const push = () => { if (run.length >= min) { found.push(run); total += run.length; } run = ""; };
  for (let i = 0; i < b.length && total < cap; i++) {
    const c = b[i];
    if ((c >= 32 && c < 127) || c === 9 || c >= 0xa0) run += String.fromCharCode(c); else push();
  }
  push();
  const ascii16: string[] = [];
  run = "";
  for (let i = 0; i + 1 < b.length && total < cap; i += 2) {
    const c = b[i] | (b[i + 1] << 8);
    if ((c >= 32 && c < 127) || c === 9 || (c >= 0xa0 && c < 0xd800)) run += String.fromCharCode(c);
    else { if (run.length >= min) { ascii16.push(run); total += run.length; } run = ""; }
  }
  if (run.length >= min) ascii16.push(run);
  // legacy .doc keeps real text as UTF-16 or cp1252 runs; prefer whichever produced more readable words
  const wordy = (a: string[]) => a.join(" ").split(/\s+/).filter((w) => /^[A-Za-zÀ-ÿ]{3,}$/.test(w)).length;
  return (wordy(ascii16) > wordy(found) ? ascii16 : found).join("\n");
}

// ── TAR ──
export interface ArchEntry { name: string; size: number; dir: boolean; date?: Date | null }
export function parseTar(buf: ArrayBuffer, cap = 20_000): ArchEntry[] {
  const b = new Uint8Array(buf);
  const out: ArchEntry[] = [];
  const dec = new TextDecoder();
  const str = (o: number, n: number) => dec.decode(b.subarray(o, o + n)).replace(/\0[\s\S]*$/, "");
  let off = 0;
  while (off + 512 <= b.length && out.length < cap) {
    if (b[off] === 0) break;
    let name = str(off, 100);
    const size = parseInt(str(off + 124, 12).trim() || "0", 8) || 0;
    const mtime = parseInt(str(off + 136, 12).trim() || "0", 8) || 0;
    const type = String.fromCharCode(b[off + 156] || 48);
    const prefix = str(off + 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    if (type !== "x" && type !== "g" && type !== "L") out.push({ name, size, dir: type === "5" || name.endsWith("/"), date: mtime ? new Date(mtime * 1000) : null });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

export async function gunzip(buf: ArrayBuffer, maxBytes = 200_000_000): Promise<ArrayBuffer> {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { reader.cancel(); throw new Error("archive is larger than 200 MB once unpacked"); }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}
