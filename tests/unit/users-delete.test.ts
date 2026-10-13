import { beforeEach, describe, expect, it, vi } from "vitest";

// DELETE /api/users regression coverage (mocked DB, no prod data):
//   - the original 500: bare profile delete dies on FK references
//   - files + audit history retained (detached, not destroyed)
//   - personal vault/notifications removed; avatar best-effort
//   - guards: non-admin, self, last admin
//   - auth failure → retryable recovery (recovered:true), not a half-delete
//   - prep failure → nothing deleted

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VICTIM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Row = Record<string, unknown>;
const state = {
  role: "admin" as "admin" | "manager" | "member" | null,
  me: ADMIN,
  tables: {} as Record<string, Row[]>,
  authUsers: new Set<string>(),
  authFail: false,
  updateFail: false,
};
const ops: string[] = [];

const FK: Record<string, string[]> = {
  // table -> FK columns pointing at profiles(id), all NO ACTION in prod
  file_index: ["owner"],
  versions: ["actor"],
  audit_logs: ["actor"],
  recovery_bin: ["deleted_by"],
  approvals: ["requester", "approver"],
  vault_items: ["owner", "created_by"],
  vault_auth: ["user_id"],
  notifications: ["user_id"],
};

function table(name: string): any {
  const rows = () => state.tables[name] ?? (state.tables[name] = []);
  const filters: { col: string; val?: unknown; vals?: unknown[]; isNull?: boolean }[] = [];
  const match = (r: Row) =>
    filters.every((f) =>
      f.isNull ? r[f.col] == null
      : f.vals !== undefined ? (f.vals as unknown[]).includes(r[f.col])
      : r[f.col] === f.val);
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return q; },
    is: (col: string, val: null) => { filters.push({ col, isNull: val === null }); return q; },
    in: (col: string, vals: unknown[]) => { filters.push({ col, vals }); return q; },
    limit: () => q,
    maybeSingle: async () => ({ data: rows().find(match) ?? null }),
    update: (patch: Row, opts?: { count: string }) => ({
      // Supports both `.eq()` (awaited directly) and `.eq().limit()` chains.
      eq: (col: string, val: unknown) => {
        const apply = async () => {
          if (state.updateFail) return { error: { message: "db down" }, count: 0 };
          filters.push({ col, val });
          let n = 0;
          for (const r of rows()) if (match(r)) { Object.assign(r, patch); n++; }
          return { error: null, count: opts?.count ? n : undefined };
        };
        return { limit: () => apply(), then: (res: (v: unknown) => unknown) => apply().then(res) };
      },
    }),
    delete: (opts?: { count: string }) => ({
      eq: async (col: string, val: unknown) => {
        filters.push({ col, val });
        if (name === "profiles") {
          // Mock prod FK enforcement: any live reference blocks the delete.
          const id = val as string;
          for (const [t, cols] of Object.entries(FK)) {
            for (const c of cols) {
              if ((state.tables[t] ?? []).some((r) => r[c] === id)) {
                return { error: { message: `violates foreign key on ${t}.${c}` }, count: 0 };
              }
            }
          }
          state.tables[name] = rows().filter((r) => !match(r));
          ops.push("delete:profiles");
          return { error: null, count: opts?.count ? 1 : undefined };
        }
        const before = rows().length;
        state.tables[name] = rows().filter((r) => !match(r));
        const n = before - state.tables[name].length;
        ops.push(`delete:${name}:${n}`);
        return { error: null, count: opts?.count ? n : undefined };
      },
    }),
  };
  return q;
}

vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => (state.role ? { id: state.me, username: state.me === ADMIN ? "admin" : "boss", role: state.role, department_tag: null } : null) };
});
vi.mock("@/lib/audit", () => ({ logAudit: async () => { ops.push("audit"); } }));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({
    from: table,
    storage: { from: () => ({ remove: async (paths: string[]) => { ops.push(`storage:remove:${paths.join(",")}`); return { error: null }; } }) },
    auth: { admin: { deleteUser: async (id: string) => {
      if (state.authFail) return { error: { message: "Auth service exploded" } };
      if (!state.authUsers.has(id)) return { error: { message: "User not found" } };
      state.authUsers.delete(id);
      ops.push("auth:delete");
      return { error: null };
    } } },
  }),
}));

import { DELETE } from "@/app/api/users/route";

const call = (user_id: string) =>
  DELETE(new Request("http://x/api/users", { method: "DELETE", body: JSON.stringify({ user_id }), headers: { "content-type": "application/json" } }));

function seed() {
  state.tables = {
    profiles: [
      { id: ADMIN, username: "admin", role: "admin" },
      { id: VICTIM, username: "victim", role: "member", avatar_path: "victim/a.png" },
      { id: MEMBER, username: "member", role: "member" },
    ],
    file_index: [{ id: "f1", owner: VICTIM, name: "keep.pdf" }],
    versions: [{ id: "v1", file_id: "f1", actor: VICTIM, v: 1 }],
    audit_logs: [{ id: 1, actor: VICTIM, actor_name: "victim", action: "add" }],
    recovery_bin: [{ file_id: "f1", deleted_by: VICTIM }],
    approvals: [{ id: "a1", requester: VICTIM, approver: ADMIN }],
    vault_items: [{ id: "s1", owner: VICTIM, created_by: VICTIM, enc_blob: "x" }],
    vault_auth: [{ user_id: VICTIM }],
    notifications: [{ id: "n1", user_id: VICTIM }],
  };
  state.authUsers = new Set([ADMIN, VICTIM, MEMBER]);
}

describe("DELETE /api/users", () => {
  beforeEach(() => {
    ops.length = 0;
    Object.assign(state, { role: "admin", me: ADMIN, authFail: false, updateFail: false });
    seed();
  });

  it("guards: non-admin 403, self 400", async () => {
    state.role = "manager";
    expect((await call(VICTIM)).status).toBe(403);
    state.role = "admin";
    expect((await call(ADMIN)).status).toBe(400);
    // nothing touched by refused calls
    expect(state.tables.profiles).toHaveLength(3);
    expect(state.authUsers.has(VICTIM)).toBe(true);
  });

  it("last admin cannot be removed", async () => {
    // Sole admin X, caller is a *different* admin identity (mocked role only)
    // so the self-guard doesn't mask the last-admin guard.
    state.tables.profiles = [{ id: VICTIM, username: "victim", role: "admin" }];
    const r = await call(VICTIM);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "cannot remove the last admin" });
  });

  it("deletes fully: files + history retained, personal data wiped, auth gone", async () => {
    const r = await call(VICTIM);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true });
    // profile + auth gone
    expect(state.tables.profiles.some((p) => p.id === VICTIM)).toBe(false);
    expect(state.authUsers.has(VICTIM)).toBe(false);
    // files retained, ownership detached
    expect(state.tables.file_index).toHaveLength(1);
    expect(state.tables.file_index[0].owner).toBeNull();
    // history retained, actor detached but names kept
    expect(state.tables.audit_logs).toHaveLength(1);
    expect(state.tables.audit_logs[0].actor).toBeNull();
    expect(state.tables.audit_logs[0].actor_name).toBe("victim");
    expect(state.tables.versions[0].actor).toBeNull();
    expect(state.tables.recovery_bin).toHaveLength(1);
    expect(state.tables.approvals[0].requester).toBeNull();
    // personal data wiped
    expect(state.tables.vault_items).toHaveLength(0);
    expect(state.tables.vault_auth).toHaveLength(0);
    expect(state.tables.notifications).toHaveLength(0);
    expect(ops).toContain("storage:remove:victim/a.png");
    expect(ops).toContain("auth:delete");
    expect(ops).toContain("audit");
  });

  it("auth failure is retryable: retry finishes with recovered:true (no half-delete)", async () => {
    state.authFail = true;
    const r1 = await call(VICTIM);
    expect(r1.status).toBe(500);
    expect(await r1.json()).toMatchObject({ code: "user_auth_delete_failed" });
    // profile gone, auth alive = the old half-deleted state
    expect(state.tables.profiles.some((p) => p.id === VICTIM)).toBe(false);
    expect(state.authUsers.has(VICTIM)).toBe(true);
    // retry finishes the job
    state.authFail = false;
    const r2 = await call(VICTIM);
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({ ok: true, recovered: true });
    expect(state.authUsers.has(VICTIM)).toBe(false);
  });

  it("404 when neither profile nor auth user exists", async () => {
    state.tables.profiles = state.tables.profiles.filter((p) => p.id !== VICTIM);
    state.authUsers.delete(VICTIM);
    const r = await call(VICTIM);
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ code: "user_not_found" });
  });

  it("prep failure aborts before anything is deleted", async () => {
    state.updateFail = true;
    const r = await call(VICTIM);
    expect(r.status).toBe(500);
    expect(await r.json()).toMatchObject({ code: "user_delete_prep_failed" });
    expect(state.tables.profiles.some((p) => p.id === VICTIM)).toBe(true);
    expect(state.authUsers.has(VICTIM)).toBe(true);
    expect(state.tables.file_index[0].owner).toBe(VICTIM);
  });
});
