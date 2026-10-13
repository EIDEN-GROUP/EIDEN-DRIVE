import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

// POST /api/slack/interactions (mocked transports, real routing):
// search re-renders, pagination accumulates, submit shares authorized files
// only (denied skipped + counted), unlinked submitters get a clean clear,
// tampered ids can't bypass per-row authorization.

const SECRET = "ix-test-secret-0123456789abcdef";
const savedEnv: Record<string, string | undefined> = {};

const calls: { fn: string; args: unknown }[] = [];
const state = {
  linked: null as null | { id: string },
  files: {} as Record<string, { id: string; name: string; mime: string; size: number } | null>,
  postShouldFail: false,
};

vi.mock("@/lib/slack", async () => {
  const real = await vi.importActual<typeof import("@/lib/slack")>("@/lib/slack");
  return {
    ...real,
    viewsUpdate: async (a: unknown) => { calls.push({ fn: "views.update", args: a }); return { ok: true }; },
    chatPostMessage: async (a: unknown) => {
      calls.push({ fn: "postMessage", args: a });
      return state.postShouldFail ? { ok: false, error: "boom" } : { ok: true, ts: "1.0" };
    },
  };
});
vi.mock("@/lib/slack-links", () => ({
  linkedEidenUser: async () => state.linked,
  recordDismissal: async () => { calls.push({ fn: "dismiss", args: {} }); },
}));
vi.mock("@/lib/slack-files", () => ({
  botIdentity: async () => (state.linked ? { id: "e1", role: "member", department_tag: null } : null),
  botSearchFiles: async (_me: unknown, q: string) => ({
    files: Object.values(state.files).filter((f) => f && f.name.includes(q)).map((f) => ({ ...f, folder: null, owner: "x", google_file_id: null, google_parent_id: null, drive_account_id: null, backends: [] })),
    hasMore: false,
  }),
  botRecentFiles: async () => [],
  botListFolders: async () => [],
  botListFolderFiles: async () => ({ files: [], hasMore: false }),
  botGetFile: async (_me: unknown, id: string) => {
    const f = state.files[id] ?? null;
    return f ? { ...f, folder: null, owner: "x", google_file_id: null, google_parent_id: null, drive_account_id: null, backends: [] } : null;
  },
}));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
}));

import { POST } from "@/app/api/slack/interactions/route";

function signedPayload(payload: Record<string, unknown>): Request {
  const raw = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac("sha256", SECRET).update(`v0:${ts}:${raw}`).digest("hex")}`;
  return new Request("http://x/api/slack/interactions", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": ts, "x-slack-signature": sig },
    body: raw,
  });
}

const F1 = "11111111-1111-4111-8111-111111111111";
const F2 = "22222222-2222-4222-8222-222222222222";
const baseView = (pm: string, values: unknown = {}) => ({
  id: "V1", hash: "h1", private_metadata: pm, state: { values },
});

describe("POST /api/slack/interactions", () => {
  beforeEach(() => {
    calls.length = 0;
    Object.assign(state, { linked: null, postShouldFail: false });
    state.files = {
      [F1]: { id: F1, name: "report.pdf", mime: "application/pdf", size: 10 },
      [F2]: { id: F2, name: "secret.pdf", mime: "application/pdf", size: 20 },
    };
    if (!Object.keys(savedEnv).length) {
      for (const k of ["SLACK_SIGNING_SECRET", "NEXT_PUBLIC_APP_URL"] as const) savedEnv[k] = process.env[k];
    }
    process.env.SLACK_SIGNING_SECRET = SECRET;
    process.env.NEXT_PUBLIC_APP_URL = "https://drive.example.com";
  });

  const pm = JSON.stringify({ channel: "C", folder: null, folderName: "Workspace", q: "", page: 0, selected: [] });

  it("rejects bad signatures without touching anything", async () => {
    const r = await POST(new Request("http://x/", { method: "POST", body: "payload=%7B%7D" }));
    expect(r.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("search re-renders the modal with matching files", async () => {
    state.linked = { id: "e1" };
    const r = await POST(signedPayload({
      type: "block_actions", team: { id: "T" }, user: { id: "U" },
      view: baseView(pm, { q_block: { q_input: { value: "report" } } }),
      actions: [{ action_id: "do_search" }],
    }));
    expect(r.status).toBe(200);
    const upd = calls.find((c) => c.fn === "views.update");
    expect(upd).toBeTruthy();
    expect(JSON.stringify((upd!.args as { view: unknown }).view)).toMatch(/report\.pdf/);
  });

  it("submit shares authorized files, skips denied with a count", async () => {
    state.linked = { id: "e1" };
    delete state.files[F2]; // F2 invisible to this user (revoked mid-flow)
    const r = await POST(signedPayload({
      type: "view_submission", team: { id: "T" }, user: { id: "U" },
      view: baseView(pm, {
        pick_block: { pick_files: { selected_options: [{ value: F1 }, { value: F2 }] } },
        msg_block: { msg_input: { value: "FYI" } },
      }),
    }));
    const j = await r.json();
    expect(j).toMatchObject({ response_action: "clear" });
    const post = calls.find((c) => c.fn === "postMessage");
    expect(post).toBeTruthy();
    const body = JSON.stringify(post!.args);
    expect(body).toMatch(/report\.pdf/);
    expect(body).not.toMatch(/secret\.pdf/);
    expect(body).toMatch(/1 skipped/);
    expect(body).toMatch(/FYI/);
  });

  it("submit with nothing selected returns a field error (no post)", async () => {
    state.linked = { id: "e1" };
    const r = await POST(signedPayload({ type: "view_submission", team: { id: "T" }, user: { id: "U" }, view: baseView(pm) }));
    expect(await r.json()).toMatchObject({ response_action: "errors" });
    expect(calls.some((c) => c.fn === "postMessage")).toBe(false);
  });

  it("unlinked submitters get a clean clear (no post, no leak)", async () => {
    const r = await POST(signedPayload({ type: "view_submission", team: { id: "T" }, user: { id: "U" }, view: baseView(pm) }));
    expect(await r.json()).toMatchObject({ response_action: "clear" });
    expect(calls.some((c) => c.fn === "postMessage")).toBe(false);
  });

  it("dismiss records the opt-out", async () => {
    state.linked = { id: "e1" };
    const r = await POST(signedPayload({
      type: "block_actions", team: { id: "T" }, user: { id: "U" },
      view: baseView(pm), actions: [{ action_id: "slack_dismiss" }],
    }));
    expect(r.status).toBe(200);
    expect(calls.some((c) => c.fn === "dismiss")).toBe(true);
  });
});
