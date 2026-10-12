import { beforeEach, describe, expect, it, vi } from "vitest";

// resync_reconcile_false_and_true + ambiguous against the real reconcile
// route: no network, no prod data. The Drive client is faked at the
// clientFor boundary; requireActiveAccount runs for real (fail-closed gate).
// startedAfter uses a fixed clock so createdTime matching is deterministic.

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const DISABLED = "22222222-2222-4222-8222-222222222222";

const state = {
  accounts: {} as Record<string, { id: string; label: string; email: string | null; refresh_token: string; root_id: string | null; status: string; priority: number }>,
  role: "member" as "admin" | "manager" | "member" | null,
  hits: [] as { id?: string; name?: string; size?: string; parents?: string[]; createdTime?: string }[],
};

const NOW = new Date("2026-10-12T12:00:00.000Z");
const iso = (msOffset: number) => new Date(NOW.getTime() + msOffset).toISOString();

function table(name: string): any {
  const q: any = {
    select: () => q, eq: () => q,
    maybeSingle: async () => {
      if (name === "drive_accounts") return { data: state.accounts[(q as any)._eq] ?? null };
      return { data: null };
    },
  };
  const origEq = q.eq;
  q.eq = (col: string, val: unknown) => { q._eq = val; return origEq(col, val); };
  return q;
}

vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => (state.role ? { id: "u1", username: "boss", role: state.role, department_tag: null } : null) };
});
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: table }),
}));
vi.mock("@/lib/rate", () => ({ rateLimited: () => false }));
vi.mock("@/lib/drive-accounts", async () => {
  const real = await vi.importActual<typeof import("@/lib/drive-accounts")>("@/lib/drive-accounts");
  return {
    ...real,
    clientFor: () => ({
      files: {
        list: async () => ({ data: { files: state.hits } }),
      },
    }),
  };
});

import { POST as reconcile } from "@/app/api/drive/resumable/reconcile/route";

const post = (body: unknown) =>
  reconcile(new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const body = { accountId: ACTIVE, name: "big.mp4", size: 1048576, parentUsed: "scope-root", startedAfter: NOW.toISOString() };

describe("resumable reconcile", () => {
  beforeEach(() => {
    state.role = "member";
    state.hits = [];
    state.accounts = {
      [ACTIVE]: { id: ACTIVE, label: "D-1111", email: null, refresh_token: "rt", root_id: "scope-root", status: "active", priority: 0 },
      [DISABLED]: { id: DISABLED, label: "D-2222", email: null, refresh_token: "rt", root_id: "scope-root", status: "disabled", priority: 0 },
    };
  });
  it("reconcile_false: nothing landed → found null (caller throws UploadUnconfirmed)", async () => {
    const r = await post(body);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, found: null });
  });
  it("reconcile_true: exactly one name+size+time match → found id", async () => {
    state.hits = [{ id: "gfile1", name: "big.mp4", size: "1048576", parents: ["scope-root"], createdTime: iso(1000) }];
    const r = await post(body);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, found: { id: "gfile1" } });
  });
  it("stale files (created before the session) do not match", async () => {
    state.hits = [{ id: "gfile0", name: "big.mp4", size: "1048576", parents: ["scope-root"], createdTime: iso(-10 * 60_000) }];
    const r = await post(body);
    expect(await r.json()).toMatchObject({ ok: true, found: null });
  });
  it("ambiguous: several matches → 409, never a guessed id", async () => {
    state.hits = [
      { id: "gfile1", name: "big.mp4", size: "1048576", parents: ["scope-root"], createdTime: iso(1000) },
      { id: "gfile2", name: "big.mp4", size: "1048576", parents: ["scope-root"], createdTime: iso(2000) },
    ];
    const r = await post(body);
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.found).toBeUndefined();
    expect(typeof j.error).toBe("string");
  });
  it("disabled drive refuses reconcile (410 drive_disabled)", async () => {
    const r = await post({ ...body, accountId: DISABLED });
    expect(r.status).toBe(410);
    expect(await r.json()).toMatchObject({ code: "drive_disabled" });
  });
});
