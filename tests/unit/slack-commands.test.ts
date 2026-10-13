import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

// POST /api/slack/commands (mocked collaborators, real verification +
// routing): unlinked → private connect prompt; dismissed → quiet text;
// linked → share modal; bad signature → rejected.

const SECRET = "cmd-test-secret-0123456789abcdef";
const savedEnv: Record<string, string | undefined> = {};

const calls: { fn: string; args: unknown }[] = [];
const state = {
  linked: null as null | { id: string },
  dismissed: false,
  modalShouldFail: false,
};

vi.mock("@/lib/slack", async () => {
  const real = await vi.importActual<typeof import("@/lib/slack")>("@/lib/slack");
  return {
    ...real,
    viewsOpen: async (a: unknown) => {
      calls.push({ fn: "views.open", args: a });
      return state.modalShouldFail ? { ok: false, error: "boom" } : { ok: true };
    },
    chatPostEphemeral: async (a: unknown) => { calls.push({ fn: "ephemeral", args: a }); return { ok: true }; },
  };
});
vi.mock("@/lib/slack-links", () => ({
  linkedEidenUser: async () => state.linked,
  mintPairingToken: async () => "eiden_testtoken",
  promptDismissed: async () => state.dismissed,
  recordDismissal: async () => { calls.push({ fn: "dismiss", args: {} }); },
  pairingUrl: (origin: string, _w: string, _u: string, t: string | null) =>
    (t && origin ? `${origin}/slack/connect?token=${t}` : origin),
}));
vi.mock("@/lib/slack-files", () => ({
  botIdentity: async () => (state.linked ? { id: "e1", role: "member", department_tag: null } : null),
  botRecentFiles: async () => [{ id: "f1", name: "a.pdf", mime: "application/pdf", size: 1 }],
  botListFolders: async () => [],
}));

import { POST } from "@/app/api/slack/commands/route";

function signedForm(fields: Record<string, string>): Request {
  const raw = new URLSearchParams({ command: "/eiden-drive", team_id: "T", user_id: "U", channel_id: "C", trigger_id: "TR", ...fields }).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac("sha256", SECRET).update(`v0:${ts}:${raw}`).digest("hex")}`;
  return new Request("http://x/api/slack/commands", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": ts, "x-slack-signature": sig },
    body: raw,
  });
}

describe("POST /api/slack/commands", () => {
  beforeEach(() => {
    calls.length = 0;
    Object.assign(state, { linked: null, dismissed: false, modalShouldFail: false });
    if (!(Object.keys(savedEnv).length)) {
      for (const k of ["SLACK_SIGNING_SECRET", "NEXT_PUBLIC_APP_URL"] as const) savedEnv[k] = process.env[k];
    }
    process.env.SLACK_SIGNING_SECRET = SECRET;
    process.env.NEXT_PUBLIC_APP_URL = "https://drive.example.com";
  });

  it("rejects bad signatures", async () => {
    const r = await POST(new Request("http://x/", { method: "POST", body: "x=1" }));
    expect(await r.json()).toMatchObject({ text: "Couldn't verify that request." });
    expect(calls).toHaveLength(0);
  });

  it("unlinked users get a private connect prompt (zero file data)", async () => {
    const r = await POST(signedForm({}));
    expect(r.status).toBe(200);
    const eph = calls.find((c) => c.fn === "ephemeral");
    expect(eph).toBeTruthy();
    const body = JSON.stringify(eph!.args);
    expect(body).toMatch(/Connect Eiden Drive/);
    expect(body).not.toMatch(/a\.pdf/);
    expect(calls.some((c) => c.fn === "views.open")).toBe(false);
  });

  it("dismissed users who run the command get the way back in (button, no unsolicited prompt)", async () => {
    state.dismissed = true;
    const r = await POST(signedForm({}));
    const j = await r.json();
    expect(j.response_type).toBe("ephemeral");
    // Explicit invocation → connect button offered; no chat.postEphemeral API call.
    expect(JSON.stringify(j.blocks)).toMatch(/slack\/connect\?token=eiden_testtoken/);
    expect(calls.some((c) => c.fn === "ephemeral")).toBe(false);
  });

  it("`dismiss` text records the opt-out", async () => {
    const r = await POST(signedForm({ text: "dismiss" }));
    expect((await r.json()).response_type).toBe("ephemeral");
    expect(calls.some((c) => c.fn === "dismiss")).toBe(true);
  });

  it("linked users get the share modal (recent files, no secrets)", async () => {
    state.linked = { id: "e1" };
    const r = await POST(signedForm({}));
    expect(r.status).toBe(200);
    const open = calls.find((c) => c.fn === "views.open");
    expect(open).toBeTruthy();
    const view = (open!.args as { view: { callback_id: string; private_metadata: string } }).view;
    expect(view.callback_id).toBe("eiden_share");
    expect(view.private_metadata).not.toMatch(/token|secret/i);
  });

  it("modal-open failure surfaces a private error", async () => {
    state.linked = { id: "e1" };
    state.modalShouldFail = true;
    const r = await POST(signedForm({}));
    expect((await r.json()).text).toMatch(/Couldn't open the file picker/);
  });
});
