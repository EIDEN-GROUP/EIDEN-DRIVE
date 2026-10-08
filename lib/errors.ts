// Exact, actionable error handling for every Google + network call.
// Rules: never swallow the cause, never show raw stack traces, always say what
// to do next. Timeouts everywhere — a hung upstream must degrade, not hang.

export async function withTimeout<T>(ms: number, p: Promise<T>, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t);
  }
}

export function isTimeout(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /timed out|timeout|abort|aborted|exceeded|ETIMEDOUT|EAI_AGAIN| socket hang up/i.test(m);
}

// The one place Google failure text becomes a human sentence with a next step.
export function googleErrorMessage(m: string): string {
  if (/invalid_grant/i.test(m)) {
    return "Google rejected this drive's token — reconnect it from Storage → … on that drive (same Gmail refreshes its token).";
  }
  if (/not.?found| 404/i.test(m)) {
    return "Google can't open the configured folder/drive — check the drive's Scope in Storage and that it's shared with the connected Gmail (/api/health shows which).";
  }
  if (isTimeout(m)) {
    return "Google took too long to answer — retry; if it keeps happening, the drive is throttling us.";
  }
  if (/quota|rate.?limit|429|403.*limit/i.test(m)) {
    return `Google rate-limited us (${m}). Wait a minute and retry Sync — nothing was lost.`;
  }
  return `Google Drive unreachable right now (${m}). Showing indexed files.`;
}

export function fetchTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(new Error(`request timed out after ${Math.round(ms / 1000)}s`)), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}
