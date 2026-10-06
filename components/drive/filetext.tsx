"use client";

// Shared file-type helpers for the viewer + editor. One source of truth so
// "can I view/edit this?" answers the same everywhere.

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const VIDEO = new Set(["mp4", "webm", "ogv", "mov"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "oga", "m4a", "flac"]);
const PDF = new Set(["pdf"]);
const TEXT_EDIT = new Set(["txt", "md", "markdown", "html", "htm", "css", "js", "ts", "tsx", "jsx", "json", "xml", "csv", "yml", "yaml", "toml", "sh", "py", "sql", "env", "log", "java", "c", "h", "cpp", "go", "rs", "php", "rb", "vue", "svelte"]);
const TEXT_VIEW = new Set([...TEXT_EDIT, "rtf", "ini", "cfg"]);
const OFFICE = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "pages", "numbers", "key"]);

export type ViewKind = "image" | "video" | "audio" | "pdf" | "markdown" | "html" | "code" | "office" | "unknown";

export function viewKind(name: string, mime?: string): ViewKind {
  const e = extOf(name);
  if (IMAGE.has(e) || mime?.startsWith("image/")) return "image";
  if (VIDEO.has(e) || mime?.startsWith("video/")) return "video";
  if (AUDIO.has(e) || mime?.startsWith("audio/")) return "audio";
  if (PDF.has(e) || mime === "application/pdf") return "pdf";
  if (e === "md" || e === "markdown" || mime === "text/markdown") return "markdown";
  if (e === "html" || e === "htm") return "html";
  if (TEXT_VIEW.has(e) || mime?.startsWith("text/") || mime === "application/json") return "code";
  if (OFFICE.has(e)) return "office";
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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
