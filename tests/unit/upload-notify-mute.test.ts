import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Per-folder Slack mutes suppress ONLY the Slack post: a muted destination
// skips postSlack while in-app notifications continue; unmuted uploads post
// both; mute-check failures fail open (post anyway, never lose the alert).

const state = { muted: false, throwOnMute: false };
const posts: string[] = [];
const notices: unknown[] = [];

function table(name: string): unknown {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.in = () => q;
  q.limit = () => q;
  q.maybeSingle = async () => {
    if (name === "file_index") return { data: { folder: "f1", google_parent_id: null, drive_account_id: null } };
    return { data: null };
  };
  q.insert = async (row: unknown) => { notices.push(row); return {}; };
  (q as { then: unknown }).then = (res: (v: unknown) => unknown) => {
    if (name === "profiles") return Promise.resolve({ data: [{ id: "mgr1" }], error: null }).then(res);
    return Promise.resolve({ data: [], error: null }).then(res);
  };
  return q;
}

vi.mock("@/lib/folder-slack-mute", () => ({
  fileSlackMuted: async () => {
    if (state.throwOnMute) throw new Error("db down");
    return state.muted;
  },
}));

const realFetch = globalThis.fetch;

import { notifyUpload } from "@/lib/upload-notify";

const db = { from: table };
const req = new Request("http://app/drive");
const args = { fileId: "f1", name: "report.pdf", size: 100, folderId: "f1" as string | null, userId: "u9", username: "sam" };

describe("upload notify folder slack mute", () => {
  beforeEach(() => {
    Object.assign(state, { muted: false, throwOnMute: false });
    posts.length = 0;
    notices.length = 0;
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
    delete process.env.SLACK_BOT_TOKEN;
    (globalThis as { fetch?: unknown }).fetch = async (url: string, init?: { body?: string }) => {
      if (String(url).startsWith("https://hooks.slack")) posts.push(String(init?.body ?? ""));
      return new Response("ok", { status: 200 });
    };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it("unmuted uploads post to Slack and notify in-app", async () => {
    await notifyUpload(db as never, req, args);
    expect(posts).toHaveLength(1);
    expect(notices.length).toBeGreaterThan(0);
  });

  it("muted destinations skip Slack but keep in-app notifications", async () => {
    state.muted = true;
    await notifyUpload(db as never, req, args);
    expect(posts).toHaveLength(0);
    expect(notices.length).toBeGreaterThan(0);
  });

  it("mute-check failures post anyway (never lose the alert)", async () => {
    state.throwOnMute = true;
    await notifyUpload(db as never, req, args);
    expect(posts).toHaveLength(1);
  });
});
