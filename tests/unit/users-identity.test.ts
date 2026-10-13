import { beforeEach, describe, expect, it, vi } from "vitest";

// PATCH /api/users identity fields (mocked DB):
// admin username rename (+trim/audit), manager/member 403 on username AND
// slack_user_id, duplicate/invalid usernames, admin slack set/clear,
// duplicate slack mappings, bad formats, dept/role behavior unchanged.

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
const state = {
  role: "admin" as "admin" | "manager" | "member",
  meId: ADMIN,
  profiles: [] as Row[],
};
const ops: string[] = [];
let auditDetail: Record<string, unknown> | null = null;

function table(name: string): any {
  const filters: { col: string; val?: unknown; vals?: unknown[]; neq?: unknown }[] = [];
  let ilike: { col: string; needle: string } | null = null;
  const match = (r: Row) =>
    filters.every((f) =>
      f.vals !== undefined ? (f.vals as unknown[]).includes(r[f.col])
      : f.neq !== undefined ? r[f.col] !== f.neq
      : r[f.col] === f.val) &&
    (!ilike || String(r[ilike.col] ?? "").toLowerCase().includes(ilike.needle));
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return q; },
    neq: (col: string, val: unknown) => { filters.push({ col, neq: val }); return q; },
    ilike: (col: string, pat: unknown) => { ilike = { col, needle: String(pat ?? "").replace(/%/g, "").toLowerCase() }; return q; },
    limit: () => q,
    order: () => q,
    maybeSingle: async () => {
      const hit = state.profiles.find(match);
      return { data: hit ? { ...hit } : null }; // snapshot copy, like the real client
    },
    // Awaited list queries (duplicate pre-checks) resolve { data }.
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: state.profiles.filter(match) }).then(res),
    update: (patch: Row) => ({
      eq: async (col: string, val: unknown) => {
        filters.push({ col, val });
        // Mock prod unique backstops.
        if (patch.username && state.profiles.some((p) => p.id !== val && String(p.username).toLowerCase() === String(patch.username).toLowerCase())) {
          return { error: { message: "duplicate key value violates unique constraint" } };
        }
        if (patch.slack_user_id && state.profiles.some((p) => p.id !== val && p.slack_user_id === patch.slack_user_id)) {
          return { error: { message: "duplicate key value violates unique constraint" } };
        }
        for (const r of state.profiles) if (match(r)) Object.assign(r, patch);
        ops.push("update:profiles");
        return { error: null };
      },
    }),
  };
  return q;
}

vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => ({ id: state.meId, username: "admin", role: state.role, department_tag: null }) };
});
vi.mock("@/lib/audit", () => ({ logAudit: async (a: { detail: Record<string, unknown> }) => { auditDetail = a.detail; ops.push("audit"); } }));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: table }),
}));

import { PATCH } from "@/app/api/users/route";

const call = (body: unknown) =>
  PATCH(new Request("http://x/api/users", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

function seed() {
  state.profiles = [
    { id: ADMIN, username: "admin", role: "admin", department_tag: null, slack_user_id: null },
    { id: U1, username: "alex.m", role: "member", department_tag: "Clients", slack_user_id: "U111AAAAA" },
    { id: U2, username: "sam.k", role: "member", department_tag: "Clients", slack_user_id: null },
  ];
}

describe("PATCH /api/users identity fields", () => {
  beforeEach(() => {
    ops.length = 0; auditDetail = null;
    Object.assign(state, { role: "admin", meId: ADMIN });
    seed();
  });

  it("admin renames (trimmed) and the audit records from→to", async () => {
    const r = await call({ user_id: U1, username: "  alex.new  " });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, username: "alex.new" });
    expect(state.profiles.find((p) => p.id === U1)?.username).toBe("alex.new");
    expect(auditDetail).toMatchObject({ username_from: "alex.m", username_to: "alex.new" });
  });

  it("managers and members get 403 on username (nothing written)", async () => {
    state.role = "manager";
    expect((await call({ user_id: U1, username: "hijack" })).status).toBe(403);
    state.role = "member";
    const r = await call({ user_id: U1, username: "hijack", department_tag: "Clients" });
    expect(r.status).toBe(403);
    expect(state.profiles.find((p) => p.id === U1)?.username).toBe("alex.m");
    expect(ops).not.toContain("update:profiles");
  });

  it("rejects duplicate (case-insensitive) and invalid usernames", async () => {
    const dup = await call({ user_id: U2, username: "ALEX.M" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ code: "username_taken" });
    expect((await call({ user_id: U2, username: "bad name!" })).status).toBe(400);
    expect((await call({ user_id: U2, username: "   " })).status).toBe(400);
    expect(state.profiles.find((p) => p.id === U2)?.username).toBe("sam.k");
  });

  it("admin sets, replaces, and clears slack links", async () => {
    expect(await (await call({ user_id: U2, slack_user_id: "u222bbbbb" })).json()).toMatchObject({ ok: true, slack_user_id: "U222BBBBB" });
    expect(state.profiles.find((p) => p.id === U2)?.slack_user_id).toBe("U222BBBBB");
    expect(await (await call({ user_id: U2, slack_user_id: null })).json()).toMatchObject({ ok: true, slack_user_id: null });
    expect(await (await call({ user_id: U2, slack_user_id: "   " })).json()).toMatchObject({ ok: true });
    expect(state.profiles.find((p) => p.id === U2)?.slack_user_id).toBeNull();
  });

  it("managers and members get 403 on slack links", async () => {
    state.role = "manager";
    expect((await call({ user_id: U2, slack_user_id: "U999ZZZZZ" })).status).toBe(403);
    state.role = "member";
    expect((await call({ user_id: U2, slack_user_id: null })).status).toBe(403);
    expect(state.profiles.find((p) => p.id === U2)?.slack_user_id).toBeNull();
  });

  it("rejects duplicate slack mappings and bad formats", async () => {
    const dup = await call({ user_id: U2, slack_user_id: "U111AAAAA" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ code: "slack_id_taken" });
    expect((await call({ user_id: U2, slack_user_id: "not an id!!" })).status).toBe(400);
  });

  it("dept/role behavior unchanged (managers still assign depts, admin-only roles)", async () => {
    state.role = "manager";
    expect((await call({ user_id: U2, department_tag: "Legal" })).status).toBe(200);
    expect((await call({ user_id: U2, role: "manager" })).status).toBe(403);
  });
});
