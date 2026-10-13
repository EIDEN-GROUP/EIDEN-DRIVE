import { describe, expect, it, vi, beforeEach } from "vitest";

// GET /api/integrations/slack — the webhook flag must never pose as whole-bot
// health. Each leg (webhook, bot token + live auth.test, signing secret, app
// URL, migrations) reports separately; credential values never reach the
// browser; uploads never depend on the bot token.

const state = {
  admin: true,
  webhook: "",
  token: "",
  secret: "",
  appUrl: "",
  authTest: null as null | { user?: string; team?: string } | { error: string },
  missingTable: null as null | string,
  missingQueueCols: false,
};

vi.mock("@/lib/roles", () => ({
  getProfile: async () => (state.admin ? { id: "a", role: "admin", username: "admin" } : null),
  can: () => state.admin,
}));
vi.mock("@/lib/slack", async () => {
  const real = await vi.importActual<typeof import("@/lib/slack")>("@/lib/slack");
  return {
    ...real,
    slackConfigured: () => !!state.webhook,
    slackApi: async () => (state.authTest && "error" in state.authTest
      ? { ok: false, error: (state.authTest as { error: string }).error }
      : { ok: true, data: state.authTest ?? {} }),
    postSlack: async () => (state.webhook ? { ok: true } : { ok: false, error: "not set" }),
  };
});
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => ({
        limit: async () => {
          if (state.missingTable === table) return { error: { message: `relation "${table}" does not exist` } };
          if (table === "slack_event_log" && cols.includes("payload") && state.missingQueueCols) {
            return { error: { message: 'column "payload" of relation "slack_event_log" does not exist' } };
          }
          return { error: null };
        },
      }),
    }),
  }),
}));

import { GET, POST } from "@/app/api/integrations/slack/route";

const KEYS = ["SLACK_WEBHOOK_URL", "SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET", "NEXT_PUBLIC_APP_URL"] as const;
const saved: Record<string, string | undefined> = {};

describe("GET /api/integrations/slack", () => {
  beforeEach(() => {
    if (!Object.keys(saved).length) for (const k of KEYS) saved[k] = process.env[k];
    Object.assign(state, {
      admin: true, webhook: "", token: "", secret: "", appUrl: "",
      authTest: null, missingTable: null, missingQueueCols: false,
    });
    for (const k of KEYS) delete process.env[k];
  });

  function syncEnv() {
    if (state.webhook) process.env.SLACK_WEBHOOK_URL = state.webhook;
    if (state.token) process.env.SLACK_BOT_TOKEN = state.token;
    if (state.secret) process.env.SLACK_SIGNING_SECRET = state.secret;
    if (state.appUrl) process.env.NEXT_PUBLIC_APP_URL = state.appUrl;
  }

  it("rejects non-admins", async () => {
    state.admin = false;
    expect((await GET()).status).toBe(403);
  });

  it("reports every leg separately when fully configured", async () => {
    Object.assign(state, {
      webhook: "https://hooks.slack/x", token: "xoxb-x", secret: "s",
      appUrl: "https://drive.eiden-group.com",
      authTest: { user: "eidenbot", team: "Eiden" },
    });
    syncEnv();
    const j = await (await GET()).json();
    expect(j.configured).toBe(true);
    expect(j.checks.webhook.ok).toBe(true);
    expect(j.checks.bot_token.ok).toBe(true);
    expect(j.checks.bot_token.detail).toMatch(/@eidenbot/);
    expect(j.checks.bot_identity).toMatchObject({ user: "eidenbot", team: "Eiden" });
    expect(j.checks.signing_secret.ok).toBe(true);
    expect(j.checks.app_url.ok).toBe(true);
    expect(j.checks.database.ok).toBe(true);
    expect(JSON.stringify(j)).not.toMatch(/xoxb-x/);
  });

  it("webhook-only setup does not claim the bot works", async () => {
    state.webhook = "https://hooks.slack/x";
    syncEnv();
    const j = await (await GET()).json();
    expect(j.configured).toBe(true);
    expect(j.checks.bot_token.ok).toBe(false);
    expect(j.checks.signing_secret.ok).toBe(false);
  });

  it("invalid_auth explains the fix without leaking the token", async () => {
    Object.assign(state, { webhook: "https://hooks.slack/x", token: "xoxb-bad", authTest: { error: "invalid_auth" } });
    syncEnv();
    const j = await (await GET()).json();
    expect(j.configured).toBe(true);
    expect(j.checks.bot_token.ok).toBe(false);
    expect(j.checks.bot_token.detail).toMatch(/invalid_auth/);
    expect(JSON.stringify(j)).not.toMatch(/xoxb-bad/);
  });

  it("missing 0022 table names the migration; 0022-only notes sync processing", async () => {
    state.missingTable = "slack_links";
    let j = await (await GET()).json();
    expect(j.checks.database.ok).toBe(false);
    expect(j.checks.database.detail).toMatch(/0022/);
    state.missingTable = null;
    state.missingQueueCols = true;
    j = await (await GET()).json();
    expect(j.checks.database.ok).toBe(true);
    expect(j.checks.database.detail).toMatch(/0023/);
  });

  it("test-message POST still honors the webhook alone", async () => {
    state.webhook = "https://hooks.slack/x";
    syncEnv();
    const ok = await POST(new Request("http://x/", { method: "POST" }));
    expect(await ok.json()).toMatchObject({ ok: true });
  });
});
