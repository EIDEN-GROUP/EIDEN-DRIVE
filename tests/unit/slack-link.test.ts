import { beforeEach, describe, expect, it, vi } from "vitest";

// Account-linking lifecycle (mocked DB, real slack-links logic):
// mint/consume happy path, reuse + expiry + mismatch rejection, atomic
// single-use, both uniqueness directions, admin-set conflict, disconnect
// semantics (clears matching profile id only), dismissal recording.

type Row = Record<string, unknown>;
const state = {
  links: [] as Row[],
  pairing: [] as Row[],
  profiles: [] as Row[],
};

function table(name: string): any {
  const filters: { col: string; val?: unknown; vals?: unknown[] }[] = [];
  const match = (r: Row) =>
    filters.every((f) =>
      f.vals !== undefined ? (f.vals as unknown[]).includes(r[f.col]) : r[f.col] === f.val);
  const store = (): Row[] => {
    if (name === "slack_links") return state.links;
    if (name === "slack_pairing") return state.pairing;
    if (name === "profiles") return state.profiles;
    return [];
  };
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return q; },
    is: (col: string, val: null) => { filters.push({ col, val }); return q; },
    lt: () => q,
    maybeSingle: async () => ({ data: store().find(match) ?? null }),
    insert: (row: unknown) => {
      const r = row as Row;
      if (name === "slack_pairing") {
        if (state.pairing.some((p) => p.token === r.token)) return { error: { message: "dup" } };
        state.pairing.push({ ...r, used_at: null });
        return { error: null };
      }
      if (name === "slack_links") {
        if (state.links.some((l) => l.workspace_id === r.workspace_id && l.slack_user_id === r.slack_user_id)) {
          return { error: { message: "duplicate key value violates unique constraint" } };
        }
        state.links.push({ ...r });
        return { error: null };
      }
      return { error: null };
    },
    update: (patch: Row) => {
      const chain: any = {
        eq: (col: string, val: unknown) => { filters.push({ col, val }); return chain; },
        is: (col: string, val: null) => { filters.push({ col, val }); return chain; },
        // Atomic-claim terminal: only still-unused rows flip.
        select: async () => {
          const out = [];
          for (const r of store()) {
            if (!match(r)) continue;
            if (name === "slack_pairing" && (r.used_at ?? null) !== null) continue;
            Object.assign(r, patch);
            out.push({ ...r });
          }
          return { data: out };
        },
        // Plain-update terminal (profiles slack id): apply to all matches.
        then: (res: (v: unknown) => unknown) => {
          for (const r of store()) if (match(r)) Object.assign(r, patch);
          return Promise.resolve({ error: null }).then(res);
        },
      };
      return chain;
    },
    upsert: async (row: Row) => {
      if (name === "slack_links") {
        const i = state.links.findIndex((l) => l.workspace_id === row.workspace_id && l.slack_user_id === row.slack_user_id);
        if (i >= 0) state.links[i] = { ...state.links[i], ...row };
        else state.links.push({ ...row });
      }
      return { error: null };
    },
    delete: () => {
      const chain: any = {
        eq: (col: string, val: unknown) => { filters.push({ col, val }); return chain; },
        lt: async () => ({ error: null }),
        then: (res: (v: unknown) => unknown) => {
          if (name === "slack_links") state.links = state.links.filter((r) => !match(r));
          if (name === "slack_pairing") state.pairing = state.pairing.filter((r) => !match(r));
          return Promise.resolve({ error: null }).then(res);
        },
      };
      return chain;
    },
  };
  return q;
}

vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: table }),
}));

import {
  mintPairingToken, consumePairingToken, bindSlackAccount, unbindSlackAccount,
  linkedEidenUser, promptDismissed, recordDismissal,
} from "@/lib/slack-links";

const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";

describe("slack pairing tokens", () => {
  beforeEach(() => {
    state.links = []; state.pairing = [];
    state.profiles = [
      { id: E1, username: "a", slack_user_id: null },
      { id: E2, username: "b", slack_user_id: null },
    ];
  });

  it("mints and consumes exactly once", async () => {
    const t = await mintPairingToken("T", "U1");
    expect(typeof t).toBe("string");
    const c1 = await consumePairingToken(t as string, "T", "U1");
    expect(c1).toMatchObject({ ok: true });
    const c2 = await consumePairingToken(t as string, "T", "U1");
    expect(c2.ok).toBe(false);
  });

  it("rejects expired, mismatched, and unknown tokens", async () => {
    const t = await mintPairingToken("T", "U1");
    state.pairing.find((p) => p.token === t)!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await consumePairingToken(t as string, "T", "U1")).ok).toBe(false);
    const t2 = await mintPairingToken("T", "U2");
    expect((await consumePairingToken(t2 as string, "T", "OTHER")).ok).toBe(false);
    expect((await consumePairingToken(t2 as string, "OTHER", "U2")).ok).toBe(false);
    expect((await consumePairingToken("eiden_nope", "T", "U2")).ok).toBe(false);
  });
});

describe("slack account binding", () => {
  beforeEach(() => {
    state.links = []; state.pairing = [];
    state.profiles = [
      { id: E1, username: "a", slack_user_id: null },
      { id: E2, username: "b", slack_user_id: null },
    ];
  });

  it("binds and reads back the link (idempotent re-link)", async () => {
    expect(await bindSlackAccount(E1, "T", "U1")).toMatchObject({ ok: true });
    expect(await linkedEidenUser("T", "U1")).toMatchObject({ id: E1 });
    expect(await bindSlackAccount(E1, "T", "U1")).toMatchObject({ ok: true });
    expect(state.profiles.find((p) => p.id === E1)?.slack_user_id).toBe("U1");
  });

  it("one Slack identity ↔ one Eiden account per workspace (both directions)", async () => {
    expect(await bindSlackAccount(E1, "T", "U1")).toMatchObject({ ok: true });
    const r = await bindSlackAccount(E2, "T", "U1");
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ code: "slack_taken" });
    const r2 = await bindSlackAccount(E1, "T", "U9");
    expect(r2.ok).toBe(false);
    expect(r2).toMatchObject({ code: "eiden_taken" });
    // ...but the same pair binds fine in another workspace.
    expect(await bindSlackAccount(E2, "T2", "U1")).toMatchObject({ ok: true });
  });

  it("refuses to override an admin-set different Slack ID", async () => {
    state.profiles.find((p) => p.id === E1)!.slack_user_id = "UADMIN";
    const r = await bindSlackAccount(E1, "T", "U1");
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ code: "admin_set" });
  });

  it("disconnect clears the link and the matching profile id only", async () => {
    await bindSlackAccount(E1, "T", "U1");
    state.profiles.find((p) => p.id === E2)!.slack_user_id = "U1"; // unrelated row, must survive
    expect(await unbindSlackAccount(E1, "T", "U1")).toMatchObject({ ok: true });
    expect(await linkedEidenUser("T", "U1")).toBeNull();
    expect(state.profiles.find((p) => p.id === E1)?.slack_user_id).toBeNull();
    expect(state.profiles.find((p) => p.id === E2)?.slack_user_id).toBe("U1");
  });

  it("records dismissals; linking clears them (prompt returns after disconnect)", async () => {
    await recordDismissal("T", "U9");
    expect(await promptDismissed("T", "U9")).toBe(true);
    expect(await promptDismissed("T", "UOTHER")).toBe(false);
    await bindSlackAccount(E1, "T", "U9");
    expect(await promptDismissed("T", "U9")).toBe(false);
    await unbindSlackAccount(E1, "T", "U9");
    expect(await promptDismissed("T", "U9")).toBe(false); // row gone → prompt available again
  });
});
