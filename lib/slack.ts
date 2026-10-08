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
