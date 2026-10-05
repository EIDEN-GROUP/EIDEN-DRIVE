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

export function badge(backends: string[]): string {
  const b: string[] = [];
  if (backends.includes("google")) b.push("☁ Google");
  if (backends.includes("local")) b.push("💾 Local");
  if (backends.includes("backup")) b.push("🛡 Backup");
  return b.join(" · ");
}

export function formatBytes(b?: number | null): string {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}
