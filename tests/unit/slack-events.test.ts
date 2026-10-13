import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

// POST /api/slack/events (mocked transports, real routing/privacy logic):
// unlinked → private prompt (no details) unless dismissed; linked + public
// share → full unfurl; linked + private → generic card WITHOUT filename;
// replays deduped; bot messages + foreign domains + composer events skipped.

const SECRET = "events-test-secret-0123456789abcdef";
const ORIGIN = "https://drive.example.com";
const savedEnv: Record<string, string | undefined> = {};

const calls: { fn: string; args: unknown }[] = [];
const state = {
  linked: null as null | { id: string },
  dismissed: false,
  files: {} as Record<string, { id: string; name: string; mime: string; size: number } | null>,
  publicIds: new Set<string>(),
  seenEvents: new Set<string>(),
  failUnfurl: false,
};

vi.mock("@/lib/slack", async () => {
  const real = await vi.importActual<typeof import("@/lib/slack")>("@/lib/slack");
  return {
    ...real,
    chatPostEphemeral: async (a: unknown) => { calls.push({ fn: "ephemeral", args: a }); return { ok: true }; },
    chatUnfurl: async (a: unknown) => {
      calls.push({ fn: "unfurl", args: a });
      return state.failUnfurl ? { ok: false, error: "boom" } : { ok: true };
    },
  };
});
vi.mock("@/lib/slack-links", () => ({
  linkedEidenUser: async () => state.linked,
  mintPairingToken: async () => "eiden_tok",
  promptDismissed: async () => state.dismissed,
  recordDismissal: async () => {},
}));
vi.mock("@/lib/slack-files", () => ({
  botIdentity: async () => (state.linked ? { id: "e1", role: "member", department_tag: null } : null),
  botGetFile: async (_me: unknown, id: string) => state.files[id] ?? null,
  hasLiveShareLink: async (id: string) => state.publicIds.has(id),
}));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({
    from: (name: string) => {
      if (name !== "slack_event_log") throw new Error("unexpected table " + name);
      return {
        insert: async (row: { event_id: string }) => {
          if (state.seenEvents.has(row.event_id)) return { error: { message: "duplicate key value violates unique constraint" } };
          state.seenEvents.add(row.event_id);
          return { error: null };
        },
        delete: () => ({ lt: async () => ({ error: null }) }),
      };
    },
  }),
}));

import { POST } from "@/app/api/slack/events/route";

const FILE_UUID = "11111111-1111-4111-8111-111111111111";

function signedEvent(event: Record<string, unknown>, eventId: string): Request {
  const raw = JSON.stringify({ type: "event_callback", event_id: eventId, team_id: "T", event });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac("sha256", SECRET).update(`v0:${ts}:${raw}`).digest("hex")}`;
  return new Request("http://x/api/slack/events", {
    method: "POST",
    headers: { "x-slack-request-timestamp": ts, "x-slack-signature": sig },
    body: raw,
  });
}
const linkEvent = (url: string, extra: Record<string, unknown> = {}) => ({
  type: "link_shared", user: "U", channel: "C", message_ts: "123.456",
  links: [{ url }], ...extra,
});

describe("POST /api/slack/events", () => {
  beforeEach(() => {
    calls.length = 0;
    Object.assign(state, { linked: null, dismissed: false, failUnfurl: false });
    state.files = {};
    state.publicIds = new Set();
    state.seenEvents = new Set();
    if (!Object.keys(savedEnv).length) {
      for (const k of ["SLACK_SIGNING_SECRET", "NEXT_PUBLIC_APP_URL"] as const) savedEnv[k] = process.env[k];
    }
    process.env.SLACK_SIGNING_SECRET = SECRET;
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
  });

  it("answers url_verification challenges", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const raw = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const sig = `v0=${createHmac("sha256", SECRET).update(`v0:${ts}:${raw}`).digest("hex")}`;
    const r = await POST(new Request("http://x/", { method: "POST", headers: { "x-slack-request-timestamp": ts, "x-slack-signature": sig }, body: raw }));
    expect(await r.json()).toMatchObject({ challenge: "abc123" });
  });

  it("rejects unverified callbacks", async () => {
    const r = await POST(new Request("http://x/", { method: "POST", body: "{}" }));
    expect(r.status).toBe(401);
  });

  it("unlinked sharers get a private prompt with zero file details", async () => {
    const url = `${ORIGIN}/drive/${FILE_UUID}`;
    const r = await POST(signedEvent(linkEvent(url), "ev1"));
    expect(r.status).toBe(200);
    const eph = calls.find((c) => c.fn === "ephemeral");
    expect(eph).toBeTruthy();
    expect(JSON.stringify(eph!.args)).not.toMatch(/report|pdf/i);
    expect(calls.some((c) => c.fn === "unfurl")).toBe(false);
  });

  it("dismissed sharers are left alone", async () => {
    state.dismissed = true;
    await POST(signedEvent(linkEvent(`${ORIGIN}/drive/${FILE_UUID}`), "ev1"));
    expect(calls).toHaveLength(0);
  });

  it("linked + publicly shared → full unfurl", async () => {
    state.linked = { id: "e1" };
    state.files[FILE_UUID] = { id: FILE_UUID, name: "Secret Report.pdf", mime: "application/pdf", size: 10 };
    state.publicIds.add(FILE_UUID);
    await POST(signedEvent(linkEvent(`${ORIGIN}/drive/${FILE_UUID}`), "ev1"));
    const unf = calls.find((c) => c.fn === "unfurl");
    expect(unf).toBeTruthy();
    expect(JSON.stringify((unf!.args as { unfurls: unknown }).unfurls)).toMatch(/Secret Report/);
  });

  it("linked + private → generic card with NO filename/size/owner leak", async () => {
    state.linked = { id: "e1" };
    state.files[FILE_UUID] = { id: FILE_UUID, name: "Secret Report.pdf", mime: "application/pdf", size: 10 };
    await POST(signedEvent(linkEvent(`${ORIGIN}/drive/${FILE_UUID}`), "ev1"));
    const unf = calls.find((c) => c.fn === "unfurl");
    expect(unf).toBeTruthy();
    const body = JSON.stringify((unf!.args as { unfurls: unknown }).unfurls);
    expect(body).not.toMatch(/Secret Report/);
    expect(body).toMatch(/EIDEN-DRIVE/);
  });

  it("invisible files also get the generic card (no oracle)", async () => {
    state.linked = { id: "e1" };
    await POST(signedEvent(linkEvent(`${ORIGIN}/drive/${FILE_UUID}`), "ev1"));
    const unf = calls.find((c) => c.fn === "unfurl");
    expect(unf).toBeTruthy();
    expect(JSON.stringify((unf!.args as { unfurls: unknown }).unfurls)).not.toMatch(/Secret Report/);
  });

  it("replays are deduped (same event_id unfurls once)", async () => {
    state.linked = { id: "e1" };
    state.files[FILE_UUID] = { id: FILE_UUID, name: "x.pdf", mime: "application/pdf", size: 1 };
    state.publicIds.add(FILE_UUID);
    const ev = linkEvent(`${ORIGIN}/drive/${FILE_UUID}`);
    await POST(signedEvent(ev, "ev-dup"));
    await POST(signedEvent(ev, "ev-dup"));
    expect(calls.filter((c) => c.fn === "unfurl")).toHaveLength(1);
  });

  it("ignores bot messages, foreign domains, and composer events", async () => {
    state.linked = { id: "e1" };
    await POST(signedEvent(linkEvent(`${ORIGIN}/drive/${FILE_UUID}`, { bot_id: "B1" }), "e1"));
    await POST(signedEvent(linkEvent("https://evil.example/drive/123"), "e2"));
    await POST(signedEvent({ type: "link_shared", user: "U", channel: "C", links: [{ url: `${ORIGIN}/drive/${FILE_UUID}` }] }, "e3"));
    expect(calls).toHaveLength(0);
  });
});
