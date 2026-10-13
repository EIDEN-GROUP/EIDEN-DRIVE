import { describe, expect, it, vi, beforeEach } from "vitest";

// Worker-side link_shared/app_home processing: composer uses the
// unfurl_id+source pair (never chat.postEphemeral against COMPOSER);
// unlinked composer shares get Slack's native user_auth prompt; posted
// unlinked shares get the private ephemeral; retries never duplicate
// completed side effects; failures carry safe codes only.

const ORIGIN = "https://drive.example.com";
const FILE_UUID = "11111111-1111-4111-8111-111111111111";

const calls: { fn: string; args: unknown }[] = [];
const state = {
  linked: null as null | { id: string },
  dismissed: false,
  files: {} as Record<string, { id: string; name: string; mime: string; size: number } | null>,
  publicIds: new Set<string>(),
  failUnfurl: null as null | string,
  failEphemeral: false,
  failPublish: false,
  noIdentity: false,
};

vi.mock("@/lib/supabase-admin", () => ({ hasAdminClient: () => true, adminClient: () => ({}) }));
vi.mock("@/lib/slack", async () => {
  const real = await vi.importActual<typeof import("@/lib/slack")>("@/lib/slack");
  return {
    ...real,
    chatPostEphemeral: async (a: unknown) => {
      calls.push({ fn: "ephemeral", args: a });
      return state.failEphemeral ? { ok: false, error: "channel_not_found" } : { ok: true };
    },
    chatUnfurl: async (a: unknown) => {
      calls.push({ fn: "unfurl", args: a });
      return state.failUnfurl ? { ok: false, error: state.failUnfurl } : { ok: true };
    },
    slackApi: async (method: string, a: unknown) => {
      calls.push({ fn: `api:${method}`, args: a });
      return state.failPublish ? { ok: false, error: "invalid_auth" } : { ok: true, data: {} };
    },
  };
});
vi.mock("@/lib/slack-links", async () => {
  const real = await vi.importActual<typeof import("@/lib/slack-links")>("@/lib/slack-links");
  return {
    ...real,
    linkedEidenUser: async () => state.linked,
    mintPairingToken: async () => "eiden_tok",
    promptDismissed: async () => state.dismissed,
  };
});
vi.mock("@/lib/slack-files", () => ({
  botIdentity: async () => (state.noIdentity ? null : state.linked ? { id: "e1", role: "member", department_tag: null } : null),
  botGetFile: async (_me: unknown, id: string) => state.files[id] ?? null,
  hasLiveShareLink: async (id: string) => state.publicIds.has(id),
}));

import { runLinkShared, runAppHome, JobFail } from "@/lib/slack-process";
import type { SlackJob, LinkSharedJobPayload } from "@/lib/slack-queue";

function linkJob(extra: Partial<LinkSharedJobPayload> = {}, jobExtra = {}): SlackJob & { payload: LinkSharedJobPayload } {
  return {
    event_id: "ev1", team_id: "T", kind: "link_shared", attempts: 0,
    prompt_sent: false, unfurled: false, ...jobExtra,
    payload: {
      user: "U", channel: "C", message_ts: "1.2",
      links: [`${ORIGIN}/drive/${FILE_UUID}`],
      unfurl_id: null, source: "posted", is_refresh: false, origin: ORIGIN, ...extra,
    },
  };
}

describe("runLinkShared", () => {
  beforeEach(() => {
    calls.length = 0;
    Object.assign(state, { linked: null, dismissed: false, failUnfurl: null, failEphemeral: false, failPublish: false, noIdentity: false });
    state.files = {};
    state.publicIds = new Set();
  });

  it("linked + public posted message → channel/ts unfurl with full details", async () => {
    state.linked = { id: "e1" };
    state.files[FILE_UUID] = { id: FILE_UUID, name: "Secret Report.pdf", mime: "application/pdf", size: 10 };
    state.publicIds.add(FILE_UUID);
    const patch = await runLinkShared(linkJob());
    expect(patch).toMatchObject({ unfurled: true });
    const unf = calls.find((c) => c.fn === "unfurl")!.args as Record<string, unknown>;
    expect(unf).toMatchObject({ channel: "C", ts: "1.2" });
    expect(JSON.stringify(unf.unfurls)).toMatch(/Secret Report/);
  });

  it("linked + private file → generic card without metadata", async () => {
    state.linked = { id: "e1" };
    state.files[FILE_UUID] = { id: FILE_UUID, name: "Secret Report.pdf", mime: "application/pdf", size: 10 };
    await runLinkShared(linkJob());
    const body = JSON.stringify((calls.find((c) => c.fn === "unfurl")!.args as { unfurls: unknown }).unfurls);
    expect(body).not.toMatch(/Secret Report/);
    expect(body).toMatch(/EIDEN-DRIVE/);
  });

  it("linked composer share → unfurl_id/source pair, no channel/ts", async () => {
    state.linked = { id: "e1" };
    state.files[FILE_UUID] = { id: FILE_UUID, name: "x.pdf", mime: "application/pdf", size: 1 };
    await runLinkShared(linkJob({ source: "composer", channel: "COMPOSER", message_ts: "U-syn", unfurl_id: "U-unfurl-1" }));
    const unf = calls.find((c) => c.fn === "unfurl")!.args as Record<string, unknown>;
    expect(unf).toMatchObject({ unfurl_id: "U-unfurl-1", source: "composer" });
    expect(unf).not.toHaveProperty("channel");
    expect(unf).not.toHaveProperty("ts");
    expect(calls.some((c) => c.fn === "ephemeral")).toBe(false);
  });

  it("unlinked posted share → private ephemeral prompt, no unfurl", async () => {
    const patch = await runLinkShared(linkJob());
    expect(patch).toMatchObject({ prompt_sent: true });
    const eph = calls.find((c) => c.fn === "ephemeral")!.args as { channel: string; user: string };
    expect(eph).toMatchObject({ channel: "C", user: "U" });
    expect(JSON.stringify(eph)).not.toMatch(/Secret Report/);
    expect(calls.some((c) => c.fn === "unfurl")).toBe(false);
  });

  it("unlinked composer share → native user_auth prompt via unfurl (never ephemeral to COMPOSER)", async () => {
    const patch = await runLinkShared(linkJob({ source: "composer", channel: "COMPOSER", message_ts: "U-syn", unfurl_id: "U-unfurl-1" }));
    expect(patch).toMatchObject({ prompt_sent: true });
    expect(calls.some((c) => c.fn === "ephemeral")).toBe(false);
    const unf = calls.find((c) => c.fn === "unfurl")!.args as Record<string, unknown>;
    expect(unf).toMatchObject({ unfurl_id: "U-unfurl-1", source: "composer", user_auth_required: true });
    expect(String(unf.user_auth_url)).toMatch(/\/slack\/connect\?token=eiden_tok/);
    expect(unf).not.toHaveProperty("unfurls");
  });

  it("dismissed sharers are skipped silently", async () => {
    state.dismissed = true;
    await runLinkShared(linkJob());
    expect(calls).toHaveLength(0);
  });

  it("retries skip already-sent prompts (no duplicates)", async () => {
    await runLinkShared(linkJob({}, { prompt_sent: true }));
    expect(calls).toHaveLength(0);
  });

  it("gone Eiden account fails permanently (dead-letter, no retry storm)", async () => {
    state.linked = { id: "ghost" };
    state.noIdentity = true;
    const err = await runLinkShared(linkJob()).catch((e) => e);
    expect(err).toBeInstanceOf(JobFail);
    expect(err).toMatchObject({ code: "no-identity", permanent: true });
  });

  it("Slack API failures fail retryably with safe codes (no bodies)", async () => {
    state.linked = { id: "e1" };
    state.files[FILE_UUID] = { id: FILE_UUID, name: "x.pdf", mime: "application/pdf", size: 1 };
    state.publicIds.add(FILE_UUID);
    state.failUnfurl = "missing_scope";
    const err = await runLinkShared(linkJob()).catch((e) => e);
    expect(err).toBeInstanceOf(JobFail);
    expect(err).toMatchObject({ code: "slack:missing_scope", permanent: false });
  });
});

describe("runAppHome", () => {
  beforeEach(() => {
    calls.length = 0;
    Object.assign(state, { linked: null, failPublish: false });
  });

  it("publishes the Home view without file data", async () => {
    await runAppHome({ event_id: "h", team_id: "T", kind: "app_home", attempts: 0, prompt_sent: false, unfurled: false, payload: { user: "U", origin: ORIGIN } });
    const pub = calls.find((c) => c.fn === "api:views.publish");
    expect(pub).toBeTruthy();
    expect(JSON.stringify(pub!.args)).not.toMatch(/Secret Report/);
  });
});
