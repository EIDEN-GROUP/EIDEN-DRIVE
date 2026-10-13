import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

// POST /api/slack/events — verify → ACK FAST → enqueue (no DB fan-out or
// Slack API call before the 200). Real composer payloads (channel COMPOSER,
// synthetic message_ts, unfurl_id, source) enqueue as source "composer";
// posted messages as "posted". Bot messages, foreign domains, and malformed
// events never reach the queue. Pre-migration "inline" verdicts still run
// the worker synchronously.

const SECRET = "events-test-secret-0123456789abcdef";
const ORIGIN = "https://drive.example.com";
const savedEnv: Record<string, string | undefined> = {};

const enqueued: { event_id: string; team_id: string; kind: string; payload: Record<string, unknown> }[] = [];
const ranInline: string[] = [];
let verdict: "queued" | "duplicate" | "inline" | "dropped" = "queued";

vi.mock("@/lib/slack-queue", () => ({
  enqueueSlackEvent: async (j: { event_id: string; team_id: string; kind: string; payload: Record<string, unknown> }) => {
    enqueued.push(j);
    return verdict;
  },
}));
vi.mock("@/lib/slack-process", () => ({
  JobFail: class JobFail extends Error {
    code: string; permanent: boolean;
    constructor(code: string, permanent = false) { super(code); this.code = code; this.permanent = permanent; }
  },
  runLinkShared: async () => { ranInline.push("link_shared"); return {}; },
  runAppHome: async () => { ranInline.push("app_home"); return {}; },
}));

import { POST } from "@/app/api/slack/events/route";

const FILE_UUID = "11111111-1111-4111-8111-111111111111";

function signed(body: Record<string, unknown>): Request {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac("sha256", SECRET).update(`v0:${ts}:${raw}`).digest("hex")}`;
  return new Request("http://x/api/slack/events", {
    method: "POST",
    headers: { "x-slack-request-timestamp": ts, "x-slack-signature": sig },
    body: raw,
  });
}
// Real posted-message payload shape (per current Events API docs).
const postedEvent = (url: string) => ({
  type: "event_callback", event_id: "ev-posted", team_id: "T",
  event: {
    type: "link_shared", channel: "C123", user: "U123", message_ts: "123456789.9875",
    unfurl_id: "C123456.123456789.987501.abc", source: "conversations_history",
    links: [{ domain: "drive.example.com", url }],
  },
});
// Real composer payload shape: channel COMPOSER + synthetic message_ts.
const composerEvent = (url: string, eventId = "ev-composer") => ({
  type: "event_callback", event_id: eventId, team_id: "T",
  event: {
    type: "link_shared", channel: "COMPOSER", user: "U123",
    message_ts: "U123-909b5454-75f8-4ac4-b325-1b40e230bbd8-gryl3kb80b3wm49ihzoo35fyqoq08n2y",
    unfurl_id: "U123-909b5454-75f8-4ac4-b325-1b40e230bbd8-gryl3kb80b3wm49ihzoo35fyqoq08n2y",
    source: "composer",
    links: [{ domain: "drive.example.com", url }],
  },
});

describe("POST /api/slack/events (enqueue)", () => {
  beforeEach(() => {
    enqueued.length = 0;
    ranInline.length = 0;
    verdict = "queued";
    if (!Object.keys(savedEnv).length) {
      for (const k of ["SLACK_SIGNING_SECRET", "NEXT_PUBLIC_APP_URL"] as const) savedEnv[k] = process.env[k];
    }
    process.env.SLACK_SIGNING_SECRET = SECRET;
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
  });

  it("answers url_verification with HTTP 200 and the exact challenge", async () => {
    const r = await POST(signed({ type: "url_verification", challenge: "abc123" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ challenge: "abc123" });
  });

  it("rejects invalid signatures with 401", async () => {
    const r = await POST(new Request("http://x/", { method: "POST", body: "{}" }));
    expect(r.status).toBe(401);
  });

  it("enqueues posted messages as source posted (fast ack, no direct Slack calls)", async () => {
    const r = await POST(signed(postedEvent(`${ORIGIN}/drive/${FILE_UUID}`)));
    expect(r.status).toBe(200);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ event_id: "ev-posted", team_id: "T", kind: "link_shared" });
    expect(enqueued[0].payload).toMatchObject({ source: "posted", channel: "C123", user: "U123" });
    expect(ranInline).toHaveLength(0);
  });

  it("enqueues real composer payloads as source composer (synthetic ts preserved)", async () => {
    const r = await POST(signed(composerEvent(`${ORIGIN}/drive/${FILE_UUID}`)));
    expect(r.status).toBe(200);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].payload).toMatchObject({
      source: "composer", channel: "COMPOSER",
      unfurl_id: "U123-909b5454-75f8-4ac4-b325-1b40e230bbd8-gryl3kb80b3wm49ihzoo35fyqoq08n2y",
    });
  });

  it("drops composer events without unfurl_id (nothing to preview against)", async () => {
    const body = composerEvent(`${ORIGIN}/drive/${FILE_UUID}`);
    delete (body.event as { unfurl_id?: string }).unfurl_id;
    expect((await POST(signed(body))).status).toBe(200);
    expect(enqueued).toHaveLength(0);
  });

  it("ignores bot messages and foreign domains without enqueueing", async () => {
    const bot = postedEvent(`${ORIGIN}/drive/${FILE_UUID}`);
    (bot.event as Record<string, unknown>).bot_id = "B1";
    await POST(signed(bot));
    await POST(signed(postedEvent("https://evil.example/drive/123")));
    expect(enqueued).toHaveLength(0);
  });

  it("enqueues app_home_opened for the worker", async () => {
    const r = await POST(signed({ type: "event_callback", event_id: "ev-home", team_id: "T", event: { type: "app_home_opened", user: "U123" } }));
    expect(r.status).toBe(200);
    expect(enqueued).toMatchObject([{ kind: "app_home" }]);
  });

  it("pre-migration inline verdicts run the worker synchronously", async () => {
    verdict = "inline";
    const r = await POST(signed(postedEvent(`${ORIGIN}/drive/${FILE_UUID}`)));
    expect(r.status).toBe(200);
    expect(ranInline).toEqual(["link_shared"]);
  });
});
