// Browser → Google resumable chunk uploader. Bytes travel straight to the
// session URI our server minted — Supabase is never contacted on this path.
//
// Spike findings (verified live against the real API, including from a real
// browser — see the CORS probe notes):
//  1. `Content-Length` is a forbidden header in browsers (XHR manages it) —
//     only `Content-Range` is set manually.
//  2. Google's 308 answers ARE CORS-readable (Range included), so progress is
//     confirmed optimistically: a 308 proves the whole request body arrived
//     (a broken connection yields no response at all). After a network error
//     the status query re-sends the in-flight chunk from its start — redundant
//     bytes are harmless, skipped bytes would corrupt.
//  3. Google's FINAL 200 (complete) answers carry NO `Access-Control-Allow-
//     Origin`, and neither do error answers (404/403/5xx). So a fully landed
//     upload looks exactly like a network failure, and every HTTP error looks
//     like CORS. Never guess here: finalize-unknown outcomes go through
//     status-query first, then server-side reconcile (authoritative,
//     CORS-free), and only then fail with an actionable message.

import { RESUMABLE_CHUNK } from "./resumable";

export class UploadCancelled extends Error {
  constructor() { super("cancelled"); this.name = "UploadCancelled"; }
}
export class UploadSessionDead extends Error {
  constructor() { super("the Google upload session expired — retry the upload"); this.name = "UploadSessionDead"; }
}
// The final bytes left but completion was never observed: the file may or may
// not exist in Drive. Never report success, never silently retry into a
// duplicate — tell the user exactly how to proceed.
export class UploadUnconfirmed extends Error {
  constructor(fileName: string) {
    super(
      `Upload couldn't be confirmed — the file may already be in Drive. ` +
        `Run Sync, then check the folder for "${fileName}": if it's there, ` +
        `it landed (nothing more to do); if not, retry the upload. ` +
        `Possible causes: connection drop, expired session, or full Google storage.`
    );
    this.name = "UploadUnconfirmed";
  }
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

export interface ResumableOptions {
  chunkSize?: number;
  signal?: AbortSignal;
  onProgress?: (confirmed: number, total: number) => void;
  /**
   * Server-side reconcile for finalize-unknown outcomes (see header note 3).
   * Must throw on server errors (e.g. ambiguous matches) and return null when
   * nothing landed. A returned id is treated as success.
   */
  onReconcile?: () => Promise<ResumableFile | null>;
}

export async function uploadResumable(
  sessionUri: string,
  file: File,
  opts?: ResumableOptions
): Promise<ResumableFile> {
  const total = file.size;
  if (!total) throw new Error("empty file — nothing to upload");
  const chunk = opts?.chunkSize ?? RESUMABLE_CHUNK;
  const signal = opts?.signal;
  const report = (confirmed: number, extra = 0) => opts?.onProgress?.(Math.min(confirmed + extra, total), total);
  let confirmed = 0;
  report(0);

  // Last resort for a finished-but-unobserved upload: status query, then
  // authoritative server reconcile, then an honest failure (never a guess).
  async function finalizeUnknown(): Promise<ResumableFile> {
    try {
      const st = await queryStatus(sessionUri, total);
      if (st.done) {
        if (!st.resource.id) throw new Error("Google didn't return the uploaded file");
        report(total);
        return st.resource;
      }
    } catch (q) {
      if (q instanceof UploadSessionDead) throw q;
      // Query itself blocked/failed — fall through to reconcile.
    }
    if (opts?.onReconcile) {
      const found = await opts.onReconcile();
      if (found?.id) {
        report(total);
        return found;
      }
    }
    throw new UploadUnconfirmed(file.name);
  }

  while (confirmed < total) {
    if (signal?.aborted) throw new UploadCancelled();
    const end = Math.min(confirmed + chunk, total);
    const slice = file.slice(confirmed, end);
    const range = `bytes ${confirmed}-${end - 1}/${total}`;
    const isFinal = end === total;
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
        if (++attempt > 3) {
          // Final chunk, still unobserved: recover via reconcile, never guess.
          if (isFinal) return finalizeUnknown();
          throw e instanceof Error ? e : new Error("upload failed");
        }
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
  // Loop exit without a resource (e.g. a 308 claimed the exact final byte):
  // same recovery — verify before reporting anything.
  return finalizeUnknown();
}
