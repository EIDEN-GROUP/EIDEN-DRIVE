export function classify(name: string, mime = ""): string {
  const n = name.toLowerCase();
  if (/\.pdf$/.test(n)) return "PDF";
  if (/\.(doc|docx)$/.test(n)) return "DOCX";
  if (/\.(xls|xlsx|csv)$/.test(n)) return "XLSX";
  if (/\.(ppt|pptx)$/.test(n)) return "PPTX";
  if (/\.(psd|ai)$/.test(n)) return "DESIGN";
  if (/\.(mp4|mov|avi|mkv)$/.test(n)) return "VIDEO";
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(n)) return "IMAGE";
  if (/\.zip$|\.rar$|\.7z$/.test(n)) return "ARCHIVE";
  if (/\.html?$/.test(n)) return "HTML";
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  return "FILE";
}

// Google-folder forest roots for the Workspace view: a google folder whose
// Drive parent is itself indexed renders ONLY under that parent (via inline
// expansion) — never as a second top-level row. Rows with no recorded parent
// or an unindexed parent stay top-level so nothing vanishes.
export function isGoogleForestRoot(
  f: { google_parent_id?: string | null }, indexedGoogleIds: Set<string>
): boolean {
  return !(f.google_parent_id && indexedGoogleIds.has(f.google_parent_id));
}
export function badge(backends: string[], accountLabel?: string | null): string {
  const b: string[] = [];
  if (backends.includes("google")) b.push(`☁ Google${accountLabel ? ` (${accountLabel})` : ""}`);
  if (backends.includes("local")) b.push("💾 Local");
  if (backends.includes("backup")) b.push("🛡 Backup");
  if (backends.includes("usb")) b.push("🔌 USB");
  return b.join(" · ");
}

// Canonical Kind label — the ONLY display string for file types. The list,
// the details pane, the file page and the viewer header all use this, so a
// type can never read three different ways in three places again.
export function displayKind(name: string, mime = ""): string {
  if (mime === "application/vnd.google-apps.folder") return "Folder";
  const e = (name.split(".").pop() ?? "").toLowerCase();
  if (mime.startsWith("image/") || /^(png|jpe?g|webp|gif|svg|bmp|ico|tiff?|heic|heif|psd|ai|raw|cr2|nef|arw)$/.test(e)) return `${e ? e.toUpperCase() + " " : ""}image`;
  if (mime.startsWith("video/") || /^(mp4|mov|avi|mkv|webm|ogv|wmv|flv|m4v)$/.test(e)) return `${e ? e.toUpperCase() + " " : ""}video`;
  if (mime.startsWith("audio/") || /^(mp3|wav|ogg|flac|m4a|aac|opus)$/.test(e)) return `${e ? e.toUpperCase() + " " : ""}audio`;
  if (mime === "application/pdf" || e === "pdf") return "PDF document";
  if (/^(doc|docx|odt|rtf)$/.test(e)) return "Word document";
  if (/^(xls|xlsx|csv|tsv|ods)$/.test(e)) return "Spreadsheet";
  if (/^(ppt|pptx|odp|key)$/.test(e)) return "Presentation";
  if (/^(zip|rar|7z|tar|gz|bz2|xz)$/.test(e)) return "Archive";
  if (/^(txt|md|markdown|json|xml|yml|yaml|toml|ini|cfg|log|csv|js|ts|jsx|tsx|py|rb|go|rs|java|c|h|cpp|css|html?|sh|sql|php)$/.test(e) || mime.startsWith("text/")) return "Text";
  return e ? `${e.toUpperCase()} file` : "File";
}
export function formatBytes(b?: number | null): string {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}

// Shared date-time format (one shape everywhere — the list, the file page
// and activity used three different ones). "—" for missing/invalid, always.
export function fmtDateTime(d?: string | null): string {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "—";
  const date = t.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  let h = t.getHours();
  const m = String(t.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${date}, ${h}:${m} ${ap}`;
}
