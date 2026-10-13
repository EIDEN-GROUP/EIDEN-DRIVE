import { describe, expect, it, vi, beforeEach } from "vitest";

// POST /api/slack/process — cron/admin worker: guard (CRON_SECRET bearer or
// admin session), claim → run → finish/fail, honest summary counts. A wrong
// bearer never falls through to the session check.

const state = {
  secret: "",
  admin: false,
  jobs: [] as { event_id: string; team_id: string; kind: "link_shared" }[],
  failures: [] as { code: string; permanent?: boolean }[],
  finished: [] as string[],
  failed: [] as { id: string; code: string; permanent?: boolean }[],
};

vi.mock("@/lib/roles", () => ({
  getProfile: async () => (state.admin ? { id: "a", role: "admin", username: "admin" } : null),
  can: () => state.admin,
}));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: () => ({ delete: () => ({ in: () => ({ lt: async () => ({ error: null }) }) }) }) }),
}));
vi.mock("@/lib/slack-queue", () => ({
  claimSlackEvents: async () => state.jobs,
  finishSlackEvent: async (id: string) => { state.finished.push(id); },
  failSlackEvent: async (id: string, code: string, opts?: { permanent?: boolean }) => {
    state.failed.push({ id, code, permanent: opts?.permanent });
  },
}));
vi.mock("@/lib/slack-process", () => ({
  JobFail: class JobFail extends Error {
    code: string; permanent: boolean;
    constructor(code: string, permanent = false) { super(code); this.code = code; this.permanent = permanent; }
  },
  runLinkShared: async (j: { event_id: string }) => {
    const f = state.failures.shift();
    if (f) {
      const { JobFail } = await import("@/lib/slack-process");
      throw new JobFail(f.code, !!f.permanent);
    }
    return { unfurled: true };
  },
  runAppHome: async () => ({}),
}));

import { POST } from "@/app/api/slack/process/route";

describe("POST /api/slack/process", () => {
  beforeEach(() => {
    Object.assign(state, { secret: "", admin: false });
    state.jobs = [];
    state.failures = [];
    state.finished = [];
    state.failed = [];
    delete process.env.CRON_SECRET;
  });

  const req = (auth?: string) =>
    new Request("http://x/api/slack/process", { method: "POST", headers: auth ? { authorization: auth } : {} });

  it("rejects anonymous calls without a secret", async () => {
    expect((await POST(req())).status).toBe(403);
  });

  it("rejects wrong bearers without falling through to sessions", async () => {
    state.secret = "cron-secret-value";
    state.admin = true; // even admins can't ride in on a bad bearer
    process.env.CRON_SECRET = state.secret;
    expect((await POST(req("Bearer wrong"))).status).toBe(403);
  });

  it("cron bearer claims, runs, and summarizes", async () => {
    state.secret = "cron-secret-value";
    process.env.CRON_SECRET = state.secret;
    state.jobs = [
      { event_id: "e1", team_id: "T", kind: "link_shared" },
      { event_id: "e2", team_id: "T", kind: "link_shared" },
    ];
    const r = await POST(req("Bearer cron-secret-value"));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, claimed: 2, done: 2, retried: 0, dead: 0 });
    expect(state.finished).toEqual(["e1", "e2"]);
  });

  it("admin sessions can trigger a manual run (no secret configured)", async () => {
    state.admin = true;
    state.jobs = [{ event_id: "e1", team_id: "T", kind: "link_shared" }];
    expect((await POST(req())).status).toBe(200);
  });

  it("retryable failures retry, permanent ones dead-letter", async () => {
    state.admin = true;
    state.jobs = [
      { event_id: "e1", team_id: "T", kind: "link_shared" },
      { event_id: "e2", team_id: "T", kind: "link_shared" },
    ];
    state.failures = [{ code: "slack:rate_limited" }, { code: "no-identity", permanent: true }];
    const j = await (await POST(req())).json();
    expect(j).toMatchObject({ claimed: 2, done: 0, retried: 1, dead: 1 });
    expect(state.failed).toMatchObject([
      { id: "e1", code: "slack:rate_limited" },
      { id: "e2", code: "no-identity", permanent: true },
    ]);
  });
});
