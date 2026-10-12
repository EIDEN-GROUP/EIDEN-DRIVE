// Bounded in-memory rate limiter for API routes (abuse-damping, not a
// security boundary — the real boundaries are auth + token entropy).
// Unlike the old per-route Maps: entries expire (GC'd), the table is capped,
// and every check keys on the client IP too, so rotating the email/param
// doesn't grant unlimited calls. Multi-instance deployments still need a
// shared store (Supabase table) for strict limits — this stops the casual
// spam/SMTP-bombing/DB-fan-out cases at negligible cost.
const hits = new Map<string, { n: number; at: number }>();
const MAX_KEYS = 5000;

function gc(now: number, windowMs: number) {
  if (hits.size <= MAX_KEYS) return;
  for (const [k, h] of hits) {
    if (now - h.at > windowMs) hits.delete(k);
    if (hits.size <= MAX_KEYS) break;
  }
  // Still over: drop oldest arbitrarily (Map preserves insertion order).
  if (hits.size > MAX_KEYS) {
    const first = hits.keys().next();
    if (!first.done) hits.delete(first.value);
  }
}

/** True when `key` exceeded `limit` calls per `windowMs`. Counts the call. */
export function rateLimited(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  gc(now, windowMs);
  const h = hits.get(key);
  if (!h || now - h.at > windowMs) { hits.set(key, { n: 1, at: now }); return false; }
  h.n++;
  return h.n > limit;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
