// Browser → Google resumable chunk uploader. Bytes travel straight to the
// session URI our server minted — Supabase is never contacted on this path.
//
// Two spike findings shape this code (verified live against the real API):
//  1. `Content-Length` is a forbidden header in browsers (XHR manages it) —
//     only `Content-Range` is set manually.
//  2. Google's 308 answers carry NO `Access-Control-Expose-Headers`, so the
//     `Range` header is unreadable from JS. Progress is therefore confirmed
//     optimistically: a 308 response proves the whole request body arrived
//     (a broken connection yields no response at all), so the chunk's end
//     becomes the confirmed offset. After a network error the status query
//     re-sends the in-flight chunk from its start — redundant bytes are
//     harmless, skipped bytes would corrupt, so we always err to re-sending.

import { RESUMABLE_CHUNK } from "./resumable";

export class UploadCancelled extends Error {
  constructor() { super("cancelled"); this.name = "UploadCancelled"; }
}
export class UploadSessionDead extends Error {
  constructor() { super("the Google upload session expired — retry the upload"); this.name = "UploadSessionDead"; }
}

export interface ResumableFile {
  id: string;
  name?: string;
  size?: string;
}

interface ChunkResult { status: number; bodyText: string }

function xhrPut(
  url: string, headers: Record<string, string>, body: Blob | null,
  onLoaded: (loaded: number) => void, signal?: AbortSignal, timeoutMs = 120_000
): Promise<ChunkResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (signal?.aborted) return reject(new UploadCancelled());
    const onAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(e.loaded); };
    xhr.onload = () => { cleanup(); resolve({ status: xhr.status, bodyText: xhr.responseText }); };
    xhr.onerror = () => { cleanup(); reject(new Error("network error during upload")); };
    xhr.onabort = () => { cleanup(); reject(new UploadCancelled()); };
    xhr.ontimeout = () => { cleanup(); reject(new Error("upload chunk timed out")); };
    xhr.timeout = timeoutMs;
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.send(body);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask Google how much of this session is confirmed. 200/201 = fully done. */
async function queryStatus(sessionUri: string, total: number): Promise<{ done: true; resource: ResumableFile } | { done: false }> {
  const r = await fetch(sessionUri, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${total}` },
    body: null,
  });
  if (r.status === 200 || r.status === 201) {
    return { done: true, resource: (await r.json().catch(() => ({}))) as ResumableFile };
  }
  if (r.status === 308) return { done: false };
  if (r.status === 404 || r.status === 410) throw new UploadSessionDead();
  throw new Error(`upload status check failed (${r.status})`);
}

/** Best-effort session cancel: any outcome settles it (Google answers 499/404
 *  for already-settled sessions — all mean "nothing more to do"). */
export async function cancelResumableSession(sessionUri: string): Promise<void> {
  try { await fetch(sessionUri, { method: "DELETE" }); } catch { /* ignore */ }
}

export async function uploadResumable(
  sessionUri: string,
  file: File,
  opts?: { chunkSize?: number; signal?: AbortSignal; onProgress?: (confirmed: number, total: number) => void }
): Promise<ResumableFile> {
  const total = file.size;
  if (!total) throw new Error("empty file — nothing to upload");
  const chunk = opts?.chunkSize ?? RESUMABLE_CHUNK;
  const signal = opts?.signal;
  const report = (confirmed: number, extra = 0) => opts?.onProgress?.(Math.min(confirmed + extra, total), total);
  let confirmed = 0;
  report(0);

  while (confirmed < total) {
    if (signal?.aborted) throw new UploadCancelled();
    const end = Math.min(confirmed + chunk, total);
    const slice = file.slice(confirmed, end);
    const range = `bytes ${confirmed}-${end - 1}/${total}`;
    let attempt = 0;
    for (;;) {
      try {
        const res = await xhrPut(sessionUri, { "Content-Range": range }, slice, (loaded) => report(confirmed, loaded), signal);
        if (res.status === 200 || res.status === 201) {
          const resource = JSON.parse(res.bodyText || "{}") as ResumableFile;
          if (!resource.id) throw new Error("Google didn't return the uploaded file");
          report(total);
          return resource;
        }
        if (res.status === 308) {
          // Full request body provably arrived (a broken pipe yields no
          // response at all): advance past this chunk.
          confirmed = end;
          report(0);
          break;
        }
        if (res.status === 404 || res.status === 410) throw new UploadSessionDead();
        throw new Error(`upload chunk failed (${res.status})`);
      } catch (e) {
        if (e instanceof UploadCancelled || e instanceof UploadSessionDead || signal?.aborted) throw e instanceof Error ? e : new UploadCancelled();
        // Network-level failure: ask Google what's actually there, then resume
        // the in-flight chunk from its start (re-sending confirmed bytes is
        // harmless; skipping unconfirmed ones would corrupt).
        if (++attempt > 3) throw e instanceof Error ? e : new Error("upload failed");
        await sleep(1000 * 2 ** (attempt - 1));
        try {
          const st = await queryStatus(sessionUri, total);
          if (st.done) {
            if (!st.resource.id) throw new Error("Google didn't return the uploaded file");
            report(total);
            return st.resource;
          }
        } catch (q) {
          if (q instanceof UploadSessionDead) throw q;
          // Status query itself failed — retry the chunk blind below.
        }
      }
    }
  }
  // total was > 0 so the loop always returns; unreachable guard for types.
  throw new Error("upload failed");
}
