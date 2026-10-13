import { describe, expect, it, vi, beforeEach } from "vitest";

// Durable queue semantics: enqueue dedups redeliveries (never marks work
// complete before it succeeds), failures back off and dead-letter with safe
// codes, stale worker claims recover, and the 0022 schema degrades to the
// legacy inline path instead of breaking.

const updates: { table: string; patch: Record<string, unknown>; eq: [string, unknown][] }[] = [];
const state = {
  insertError: null as null | { message: string },
  row: null as null | { status?: string; attempts?: number },
  attempts: 0,
  rpcData: [] as unknown[],
  rpcError: null as null | { message: string },
};

function table(name: string) {
  return {
    // Full job-row inserts carry `payload`; legacy 0022 inserts are bare
    // {event_id} — the mock honors that so schema-degradation is testable.
    insert: async (row: Record<string, unknown>) => ({ error: "payload" in row ? state.insertError : null }),
    select: (cols: string) => ({
      eq: (_c: string, _v: unknown) => ({
        eq: (_c2: string, _v2: unknown) => ({ maybeSingle: async () => ({ data: { attempts: state.attempts } }) }),
        // Enqueue requeue-checks select status+attempts; fail-path reads attempts.
        maybeSingle: async () => ({ data: /status/.test(cols) ? state.row : { attempts: state.attempts } }),
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: async (c: string, v: unknown) => {
        updates.push({ table: name, patch, eq: [[c, v]] });
        return { error: null };
      },
    }),
  };
}

vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({
    from: (name: string) => table(name),
    rpc: async () => (state.rpcError ? { data: null, error: state.rpcError } : { data: state.rpcData, error: null }),
  }),
}));

import { enqueueSlackEvent, claimSlackEvents, finishSlackEvent, failSlackEvent, backoffFor } from "@/lib/slack-queue";

const JOB = { event_id: "ev1", team_id: "T", kind: "link_shared" as const, payload: { user: "U" } as never };

describe("slack queue", () => {
  beforeEach(() => {
    updates.length = 0;
    Object.assign(state, { insertError: null, row: null, attempts: 0, rpcData: [], rpcError: null });
  });

  it("backs off exponentially with a 1h cap", () => {
    expect([backoffFor(1), backoffFor(2), backoffFor(3), backoffFor(8), backoffFor(99)])
      .toEqual([30, 60, 120, 3600, 3600]);
  });

  it("fresh events queue", async () => {
    expect(await enqueueSlackEvent(JOB)).toBe("queued");
  });

  it("redeliveries of done/pending rows are duplicates (no rework)", async () => {
    state.insertError = { message: 'duplicate key value violates unique constraint "slack_event_log_pkey"' };
    state.row = { status: "done", attempts: 1 };
    expect(await enqueueSlackEvent(JOB)).toBe("duplicate");
    state.row = { status: "pending", attempts: 0 };
    expect(await enqueueSlackEvent(JOB)).toBe("duplicate");
    expect(updates).toHaveLength(0);
  });

  it("redelivery of a retryable failure requeues it", async () => {
    state.insertError = { message: "duplicate key" };
    state.row = { status: "pending", attempts: 2 };
    expect(await enqueueSlackEvent(JOB)).toBe("queued");
    expect(updates.some((u) => u.patch.status === undefined)).toBe(true); // backoff untouched, due now
  });

  it("missing queue schema degrades to legacy inline (0022 behavior preserved)", async () => {
    state.insertError = { message: 'column "payload" of relation "slack_event_log" does not exist' };
    expect(await enqueueSlackEvent(JOB)).toBe("inline");
  });

  it("transient DB failures drop (Slack redelivery retries the enqueue)", async () => {
    state.insertError = { message: "connection refused" };
    const realWarn = console.warn;
    console.warn = () => {};
    try {
      expect(await enqueueSlackEvent(JOB)).toBe("dropped");
    } finally {
      console.warn = realWarn;
    }
  });

  it("claim maps worker rows", async () => {
    state.rpcData = [{ event_id: "e", team_id: "T", kind: "app_home", attempts: 1, payload: { user: "U" }, prompt_sent: false, unfurled: false }];
    const jobs = await claimSlackEvents(5);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ event_id: "e", kind: "app_home", attempts: 1 });
  });

  it("finish marks done with side-effect flags", async () => {
    await finishSlackEvent("e", { unfurled: true });
    expect(updates[0].patch).toMatchObject({ status: "done", unfurled: true, last_error: null });
  });

  it("failure backs off while attempts remain", async () => {
    state.attempts = 1;
    await failSlackEvent("e", "slack:missing_scope");
    const patch = updates[0].patch as { status: string; attempts: number; next_attempt_at: string; last_error: { code: string } };
    expect(patch.status).toBe("pending");
    expect(patch.attempts).toBe(2);
    expect(new Date(patch.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(patch.last_error.code).toBe("slack:missing_scope");
  });

  it("exhausted or permanent failures dead-letter with the safe code", async () => {
    state.attempts = 7;
    await failSlackEvent("e", "slack:channel_not_found");
    expect((updates[0].patch as { status: string }).status).toBe("dead");
    updates.length = 0;
    state.attempts = 0;
    await failSlackEvent("e", "no-identity", { permanent: true });
    expect((updates[0].patch as { status: string }).status).toBe("dead");
  });
});
