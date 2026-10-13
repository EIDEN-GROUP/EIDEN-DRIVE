export const dynamic = "force-dynamic";

import { getProfile, can } from "@/lib/roles";
import { postSlack, slackConfigured, slackApi } from "@/lib/slack";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";

export interface SlackCheck { ok: boolean; detail: string }
export interface SlackHealth {
  configured: boolean; // webhook only — UNCHANGED semantics (upload notifications)
  checks: {
    webhook: SlackCheck;
    bot_token: SlackCheck;
    bot_identity: { user: string; team: string } | null;
    signing_secret: SlackCheck;
    app_url: SlackCheck;
    database: SlackCheck;
    scopes_note: string;
  };
}

// Managers+: check the wiring + send a live test message to the channel.
//
// `configured` is the UPLOAD-WEBHOOK flag only — it must never be read as
// "the whole bot works". The `checks` object reports every integration leg
// separately: webhook, bot token (live auth.test when present), signing
// secret presence, canonical app URL, and migration readiness. Credential
// VALUES never leave the server (presence + safe diagnostics only).
export async function GET() {
  const me = await getProfile();
  if (!me || !can(me.role, "admin-only")) return Response.json({ error: "admins only", code: "forbidden" }, { status: 403 });

  const webhookSet = slackConfigured();
  const checks: SlackHealth["checks"] = {
    webhook: webhookSet
      ? { ok: true, detail: "Upload notifications will post to the webhook channel." }
      : { ok: false, detail: "SLACK_WEBHOOK_URL is not set — uploads succeed, nothing posts." },
    bot_token: { ok: false, detail: "SLACK_BOT_TOKEN is not set — picker, prompts, and unfurls are off; uploads still work." },
    bot_identity: null,
    signing_secret: process.env.SLACK_SIGNING_SECRET?.trim()
      ? { ok: true, detail: "Signing secret is set — callbacks are HMAC-verified." }
      : { ok: false, detail: "SLACK_SIGNING_SECRET is not set — every Slack callback is rejected." },
    app_url: appUrlCheck(),
    database: await databaseCheck(),
    scopes_note: "Token validity is tested live (auth.test). Scope grants (commands, chat:write, links:read, links:write) can't be dry-tested safely — verify them in api.slack.com → OAuth & Permissions, and reinstall the app after any scope or domain change.",
  };

  if (process.env.SLACK_BOT_TOKEN?.trim()) {
    const t = await slackApi<{ user?: string; team?: string }>("auth.test", {});
    if (t.ok) {
      checks.bot_token = { ok: true, detail: `Bot token is valid${t.data.user ? ` — connected as @${t.data.user}` : ""}${t.data.team ? ` in ${t.data.team}` : ""}.` };
      checks.bot_identity = { user: t.data.user ?? "", team: t.data.team ?? "" };
    } else {
      checks.bot_token = { ok: false, detail: botTokenError(t.error) };
    }
  }
  return Response.json({ configured: webhookSet, checks } satisfies SlackHealth);
}

function appUrlCheck(): SlackCheck {
  const url = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "";
  if (!url) {
    return { ok: false, detail: "NEXT_PUBLIC_APP_URL is not set — drive-link detection and Open buttons fall back to the request origin." };
  }
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, detail: `NEXT_PUBLIC_APP_URL is "${url}" — production must be https://drive.eiden-group.com.` };
  }
  return { ok: true, detail: `Canonical app URL is ${url}.` };
}

function botTokenError(code: string): string {
  if (code === "invalid_auth") {
    return "Bot token rejected (invalid_auth) — copy a fresh Bot User OAuth Token from api.slack.com → OAuth & Permissions into SLACK_BOT_TOKEN in Vercel, then redeploy. Uploads are unaffected.";
  }
  if (code === "account_inactive") {
    return "Bot user is deactivated (account_inactive) — reactivate or reinstall the Slack app. Uploads are unaffected.";
  }
  if (code === "rate_limited" || /^HTTP 5/.test(code)) {
    return `Slack is throttling/failing right now (${code}) — transient; uploads are unaffected.`;
  }
  return `Bot token check failed (${code}) — uploads are unaffected.`;
}

async function databaseCheck(): Promise<SlackCheck> {
  if (!hasAdminClient()) {
    return { ok: false, detail: "Server DB client is not configured — cannot verify bot tables." };
  }
  const db = adminClient();
  const probe = async (table: string, cols: string): Promise<string | null> => {
    try {
      const { error } = await db.from(table).select(cols).limit(1);
      return error ? (error.message ?? "query failed") : null;
    } catch (e) {
      return e instanceof Error ? e.message : "query failed";
    }
  };
  const tables: [string, string][] = [
    ["slack_links", "workspace_id"],
    ["slack_pairing", "token"],
    ["slack_event_log", "event_id"],
  ];
  for (const [t, col] of tables) {
    const err = await probe(t, col);
    if (err) {
      if (/does not exist|42P01|PGRST|not.*found|schema cache/i.test(err)) {
        return { ok: false, detail: `Table "${t}" is missing — migration 0022 is not applied. Uploads work; linking, prompts, and unfurls refuse loudly until it is applied (maintenance window, with approval).` };
      }
      return { ok: false, detail: `Could not read "${t}" (${err.slice(0, 80)}) — transient? Uploads are unaffected.` };
    }
  }
  const queueErr = await probe("slack_event_log", "event_id,team_id,kind,status,attempts,next_attempt_at,payload,prompt_sent,unfurled,last_error,updated_at");
  if (queueErr) {
    return { ok: true, detail: "Bot tables are ready (0022). Queue columns are missing — events process synchronously until 0023 is applied (maintenance window, with approval)." };
  }
  return { ok: true, detail: "Bot tables + event queue are ready (0022 + 0023)." };
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "admin-only")) return Response.json({ error: "admins only", code: "forbidden" }, { status: 403 });
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const r = await postSlack(`✅ Eiden Drive test from *${me.username}* — upload notifications reach this channel. (${origin})`);
  if (!r.ok) return Response.json({ error: r.error }, { status: 502 });
  return Response.json({ ok: true });
}
