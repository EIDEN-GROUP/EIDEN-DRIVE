// Outgoing Slack webhook. Fire-and-forget by convention: callers never await
// success, only log it. Returns true when Slack accepted the message.
export async function postSlack(text: string, opts?: { unfurl_links?: boolean; unfurl_media?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) return { ok: false, error: "SLACK_WEBHOOK_URL is not set — add an Incoming Webhook URL in Vercel env, then redeploy" };
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10_000);
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, ...opts }),
      signal: c.signal
    }).finally(() => clearTimeout(t));
    if (!r.ok) return { ok: false, error: `Slack rejected it (HTTP ${r.status}) — the webhook may be revoked; create a new one in Slack → Apps → Incoming Webhooks` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Slack post failed" };
  }
}

export function slackConfigured(): boolean {
  return !!process.env.SLACK_WEBHOOK_URL?.trim();
}

export function slackBotConfigured(): boolean {
  return !!process.env.SLACK_BOT_TOKEN?.trim();
}

// ── Request verification (Slack signing secret) ─────────────────────
// Every slash-command, interaction, and event payload must pass this before
// anything else runs. Timestamp tolerance kills replays; the HMAC binds the
// exact raw body (parse AFTER verifying — never trust parsed fields first).
export async function verifySlackRequest(req: Request, rawBody: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const secret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!secret) {
    console.warn("[slack] SLACK_SIGNING_SECRET not set — rejecting all Slack callbacks");
    return { ok: false, error: "slack not configured" };
  }
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  if (!ts || !sig) return { ok: false, error: "missing signature" };
  const age = Date.now() / 1000 - Number(ts);
  if (!Number.isFinite(age) || Math.abs(age) > 300) return { ok: false, error: "stale request" };
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`v0:${ts}:${rawBody}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const want = `v0=${hex}`;
  // Constant-time compare (length check first — timing-safe compare needs
  // equal lengths; a length mismatch is already a reject).
  if (sig.length !== want.length) return { ok: false, error: "bad signature" };
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= sig.charCodeAt(i) ^ want.charCodeAt(i);
  if (diff !== 0) return { ok: false, error: "bad signature" };
  return { ok: true };
}

// ── Authenticated Web API client (bot token) ────────────────────────
// Server-only: SLACK_BOT_TOKEN must never reach the browser. Every call is
// bounded (10s) and returns a typed {ok} — callers decide fallback, and
// upload paths must never fail because Slack did.
export async function slackApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: "SLACK_BOT_TOKEN is not set" };
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10_000);
    const r = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: c.signal,
    }).finally(() => clearTimeout(t));
    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } & T | null;
    if (!r.ok || !j || j.ok !== true) {
      return { ok: false, error: (j && typeof j === "object" && "error" in j && typeof j.error === "string" && j.error) || `HTTP ${r.status}` };
    }
    return { ok: true, data: j as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "slack api failed" };
  }
}

/** Post a message as the bot. Returns the message ts on success. */
export async function chatPostMessage(args: {
  channel: string; text: string; blocks?: unknown[]; thread_ts?: string; unfurl_links?: boolean; unfurl_media?: boolean;
}): Promise<{ ok: true; ts: string } | { ok: false; error: string }> {
  const r = await slackApi<{ ts?: string; message?: { ts?: string } }>("chat.postMessage", args);
  if (!r.ok) return r;
  const ts = r.data.ts ?? r.data.message?.ts;
  if (!ts) return { ok: false, error: "no ts returned" };
  return { ok: true, ts };
}

/** Ephemeral (visible-only-to-one-user) message. */
export async function chatPostEphemeral(args: { channel: string; user: string; text: string; blocks?: unknown[] }): Promise<{ ok: boolean; error?: string }> {
  const r = await slackApi("chat.postEphemeral", args);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Open (or update) a modal. Surface ids make stale-submit races detectable. */
export async function viewsOpen(args: { trigger_id: string; view: unknown }): Promise<{ ok: boolean; error?: string }> {
  const r = await slackApi("views.open", args);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function viewsUpdate(args: { view_id: string; view: unknown; hash?: string }): Promise<{ ok: boolean; error?: string }> {
  const r = await slackApi("views.update", args);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Unfurl one or more links (app unfurl domains must be registered first). */
export async function chatUnfurl(args: { channel: string; ts: string; unfurls: Record<string, unknown> }): Promise<{ ok: boolean; error?: string }> {
  const r = await slackApi("chat.unfurl", args);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// ── EIDEN-DRIVE link helpers ────────────────────────────────────────
// Canonical origin comes from existing config — never hard-coded, so staging
// and production each match only their own links.
export function appOrigin(req?: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (env) return env;
  if (req) return new URL(req.url).origin;
  return "";
}

/** Match `${origin}/drive/<uuid>` links (file page + optional query). Null otherwise. */
export function parseDriveLink(url: string, origin: string): { fileId: string } | null {
  if (!origin) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const o = new URL(origin);
  if (u.protocol !== o.protocol || u.host !== o.host) return null;
  const m = /^\/drive\/([0-9a-fA-F-]{36})\/?$/.exec(u.pathname);
  if (!m) return null;
  return { fileId: m[1].toLowerCase() };
}

// Display-name lookup for upload notifications (users.info, read-only).
// Needs SLACK_BOT_TOKEN with the users:read scope (minimum; see setup notes
// in the Storage Slack card + final report). Results cache in-process for an
// hour (bounded size) so uploads don't each cost an API call. Returns null on
// ANY failure — callers fall back to the Eiden username and keep going.
const displayCache = new Map<string, { at: number; name: string }>();
const DISPLAY_TTL = 3600_000;
const DISPLAY_MAX = 500;

export async function slackDisplayName(userId: string): Promise<string | null> {
  const id = (userId ?? "").trim().toUpperCase();
  if (!id) return null;
  const hit = displayCache.get(id);
  if (hit && Date.now() - hit.at < DISPLAY_TTL) return hit.name;
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) {
    console.warn("[slack] SLACK_BOT_TOKEN not set — upload mentions fall back to Eiden usernames");
    return null;
  }
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 8000);
    const r = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` }, signal: c.signal,
    }).finally(() => clearTimeout(t));
    if (!r.ok) {
      console.warn(`[slack] users.info HTTP ${r.status} for ${id} — falling back to Eiden username`);
      return null;
    }
    const j = (await r.json().catch(() => null)) as {
      ok?: boolean; error?: string;
      user?: { name?: string; profile?: { display_name?: string; real_name?: string } };
    } | null;
    if (!j?.ok || !j.user) {
      console.warn(`[slack] users.info rejected ${id} (${j?.error ?? "unknown"}) — falling back to Eiden username`);
      return null;
    }
    // display_name → name → real_name; sanitized so the label can't break
    // mrkdwn or smuggle a real mention (no <@…> is ever emitted).
    const raw = j.user.profile?.display_name || j.user.name || j.user.profile?.real_name || "";
    const name = raw.replace(/[`\n\r<>@]/g, "").trim().slice(0, 80);
    if (!name) {
      console.warn(`[slack] users.info returned no usable name for ${id} — falling back to Eiden username`);
      return null;
    }
    if (displayCache.size >= DISPLAY_MAX) {
      const oldest = [...displayCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
      if (oldest) displayCache.delete(oldest);
    }
    displayCache.set(id, { at: Date.now(), name });
    return name;
  } catch (e) {
    console.warn(`[slack] users.info failed for ${id} (${e instanceof Error ? e.message : e}) — falling back to Eiden username`);
    return null;
  }
}

/** Test seam: clear the display-name cache. */
export function _clearSlackDisplayCache() { displayCache.clear(); }
