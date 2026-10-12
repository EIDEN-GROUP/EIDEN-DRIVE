// Direct-to-Google resumable uploads: the browser sends bytes straight to
// Google Drive in chunks — our server never touches file bytes and Supabase
// Storage is never involved at any stage (no staging, no temp objects).
// Only file_index rows (Postgres metadata) are written, on completion.
//
// NOTE: this module must never import @/lib/storage (or anything that touches
// Storage) — the upload-resumable test suite enforces that by failing any
// Storage access during the init→complete flow.

// 2 GB application cap: far above the pain point, sane abuse surface. Google
// allows terabytes per file; browsers stream chunks fine — the cap is policy.
export const RESUMABLE_MAX = 2 * 1024 ** 3;
// 8 MiB chunks: a multiple of Google's required 256 KiB granule. Small enough
// for smooth progress + cheap retries, large enough to keep request counts sane.
export const RESUMABLE_CHUNK = 8 * 1024 * 1024;
// Drive file/folder id shape (shared with upload/copy/move routes).
export const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

// Opens a resumable session bound to exact metadata (name/mime/parents/size).
// Chunk PUTs cannot alter any of it — the session only accepts the
// pre-authorized bytes, so a tampered client can't redirect the upload.
export async function initiateResumableSession(
  accessToken: string,
  opts: { name: string; mime: string; size: number; parents?: string[] }
): Promise<string> {
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": opts.mime,
      "X-Upload-Content-Length": String(opts.size),
    },
    body: JSON.stringify({
      name: opts.name,
      mimeType: opts.mime,
      ...(opts.parents?.length ? { parents: opts.parents } : {}),
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`couldn't start the Google upload (${r.status}${t ? `: ${t.slice(0, 160)}` : ""})`);
  }
  const uri = r.headers.get("location");
  if (!uri) throw new Error("Google didn't return an upload session");
  return uri;
}
