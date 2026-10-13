import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Upload-notification identity (mocked DB + HTTP):
// `Uploaded by `@display` / eiden_name` with a literal, non-pinging label;
// graceful fallback (no link, bad link, lookup failure, outage, no token);
// display-name caching (one users.info per ID); existing message info kept.

const calls: { url: string; body: unknown }[] = [];
let usersInfoMode: "ok" | "reject" | "throw" | "noname" = "ok";

function table(name: string): any {
  const q: any = {
    select: () => q, eq: () => q, in: () => q, limit: () => q,
    maybeSingle: async () => {
      if (name === "profiles") return { data: { slack_user_id: state.slackId } };
      if (name === "folders") return { data: { name: "Clients" } };
      return { data: null };
    },
    insert: async () => ({}),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
  };
  void name;
  return q;
}

const state = { slackId: "U012ABC34" as string | null };

const realFetch = globalThis.fetch;
function stubFetch() {
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, body });
    if (url.startsWith("https://slack.com/api/users.info")) {
      if (usersInfoMode === "throw") throw new Error("network down");
      if (usersInfoMode === "reject") return new Response(JSON.stringify({ ok: false, error: "user_not_found" }), { status: 200 });
      if (usersInfoMode === "noname") return new Response(JSON.stringify({ ok: true, user: {} }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, user: { name: "alex", profile: { display_name: "alex" } } }), { status: 200 });
    }
    return new Response("ok", { status: 200 });
  };
}

const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  calls.length = 0;
  usersInfoMode = "ok";
  state.slackId = "U012ABC34";
  for (const k of ["SLACK_BOT_TOKEN", "SLACK_WEBHOOK_URL", "NEXT_PUBLIC_APP_URL"]) {
    savedEnv[k] = process.env[k];
  }
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
  delete process.env.NEXT_PUBLIC_APP_URL;
  stubFetch();
});
afterEach(() => {
  for (const k of ["SLACK_BOT_TOKEN", "SLACK_WEBHOOK_URL", "NEXT_PUBLIC_APP_URL"]) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  globalThis.fetch = realFetch;
});

import { notifyUpload } from "@/lib/upload-notify";
import { _clearSlackDisplayCache } from "@/lib/slack";

const db = { from: table };
const req = new Request("http://app/drive");
const args = { fileId: "f1", name: "report.pdf", size: 2048, folderId: null as string | null, userId: "u1", username: "alex.m" };
const webhookText = () => calls.filter((c) => c.url.startsWith("https://hooks.slack")).map((c) => (c.body as { text: string }).text).join("\n");
const infoCalls = () => calls.filter((c) => c.url.startsWith("https://slack.com/api/users.info")).length;

describe("upload notify identity", () => {
  beforeEach(() => { _clearSlackDisplayCache(); });

  it("shows `Slack display` / eiden username as a literal non-pinging label", async () => {
    await notifyUpload(db as never, req, args);
    const text = webhookText();
    expect(text).toContain("Uploaded by `@alex` / alex.m");
    expect(text).not.toContain("<@");
    expect(text).not.toContain("U012ABC34");
  });

  it("keeps existing info (file, location, type, size, link)", async () => {
    await notifyUpload(db as never, req, args);
    const text = webhookText();
    expect(text).toContain("report.pdf");
    expect(text).toContain("PDF Document");
    expect(text).toContain("2 KB");
    expect(text).toContain("http://app/drive/f1");
  });

  it("falls back to the Eiden username with no linked ID", async () => {
    state.slackId = null;
    await notifyUpload(db as never, req, args);
    const text = webhookText();
    expect(text).toContain("Uploaded by alex.m");
    expect(text).not.toContain("@alex");
    expect(infoCalls()).toBe(0);
  });

  it("falls back on lookup rejection, empty names, outage, or missing token", async () => {
    usersInfoMode = "reject";
    _clearSlackDisplayCache();
    await notifyUpload(db as never, req, args);
    expect(webhookText()).toContain("Uploaded by alex.m");

    usersInfoMode = "noname";
    _clearSlackDisplayCache();
    await notifyUpload(db as never, req, args);
    expect(webhookText()).toContain("Uploaded by alex.m");

    usersInfoMode = "throw";
    _clearSlackDisplayCache();
    await expect(notifyUpload(db as never, req, args)).resolves.toBeUndefined();
    expect(webhookText()).toContain("Uploaded by alex.m");

    delete process.env.SLACK_BOT_TOKEN;
    _clearSlackDisplayCache();
    await notifyUpload(db as never, req, args);
    expect(webhookText()).toContain("Uploaded by alex.m");
  });

  it("caches display names (one users.info per ID, uploads unaffected)", async () => {
    await notifyUpload(db as never, req, args);
    await notifyUpload(db as never, req, args);
    expect(infoCalls()).toBe(1);
    expect(webhookText().split("Uploaded by `@alex` / alex.m").length - 1).toBe(2);
  });

  it("sends unfurl suppression flags on the webhook payload (scoped to upload alerts)", async () => {
    await notifyUpload(db as never, req, args);
    const hook = calls.find((c) => c.url.startsWith("https://hooks.slack"));
    expect(hook).toBeTruthy();
    expect(hook!.body).toMatchObject({ unfurl_links: false, unfurl_media: false });
  });

  it("sanitizes hostile display names (no mention smuggling, no mrkdwn breakage)", async () => {
    (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      if (url.startsWith("https://slack.com/api/users.info")) {
        return new Response(JSON.stringify({ ok: true, user: { name: "<@U999>\n`hack`" } }), { status: 200 });
      }
      return new Response("ok", { status: 200 });
    };
    _clearSlackDisplayCache();
    await notifyUpload(db as never, req, args);
    const text = webhookText();
    expect(text).not.toContain("<@U999>");
    expect(text).toContain("`@U999hack` / alex.m");
  });
});
