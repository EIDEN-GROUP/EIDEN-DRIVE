// Outgoing Slack webhook. Fire-and-forget by convention: callers never await
// success, only log it. Returns true when Slack accepted the message.
export async function postSlack(text: string): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) return { ok: false, error: "SLACK_WEBHOOK_URL is not set — add an Incoming Webhook URL in Vercel env, then redeploy" };
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10_000);
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }), signal: c.signal
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
