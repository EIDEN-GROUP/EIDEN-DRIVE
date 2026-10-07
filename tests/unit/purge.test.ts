import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { role: "manager" as "admin" | "manager" | "member" | null, file: null as null | Record<string, unknown>, inBin: true, storageErr: null as null | string, googleErr: null as null | Error, ctx: true };
const ops: string[] = [];

function table(name: string) {
  const q = {
    select: () => q, eq: () => q, in: () => q,
    maybeSingle: async () => ({ data: name === "file_index" ? state.file : name === "recovery_bin" ? (state.inBin ? { file_id: "x" } : null) : null }),
    delete: () => { ops.push(`delete:${name}`); return { eq: async () => ({ error: null }) }; },
    update: () => { ops.push(`update:${name}`); return { eq: async () => ({ error: null }) }; }
  };
  return q;
}
vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => (state.role ? { id: "u1", username: "boss", role: state.role, department_tag: null } : null) };
});
vi.mock("@/lib/audit", () => ({ logAudit: async () => { ops.push("audit"); } }));
vi.mock("@/lib/supabase-admin", () => ({
  adminClient: () => ({ from: table, storage: { from: () => ({ remove: async () => { ops.push("storage:remove"); return { error: state.storageErr ? { message: state.storageErr } : null }; } }) } })
}));
vi.mock("@/lib/drive-accounts", () => ({ driveCtxFor: async () => (state.ctx ? { drive: {}, rootId: "", label: "Main" } : null) }));
vi.mock("@/lib/google-drive", () => ({ deleteDriveFile: async () => { ops.push("google:delete"); if (state.googleErr) throw state.googleErr; return {}; } }));

import { POST } from "@/app/api/drive/purge/route";
const FILE_ID = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown = { file_id: FILE_ID }) => POST(new Request("http://x/api/drive/purge", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe("POST /api/drive/purge (permanent delete)", () => {
  beforeEach(() => {
    ops.length = 0; Object.assign(state, { role: "manager", inBin: true, storageErr: null, googleErr: null, ctx: true,
      file: { id: FILE_ID, name: "old.pdf", size: 10, hash: "abc", storage_path: "u1/old.pdf", google_file_id: "g1", drive_account_id: "acc" } });
  });
  it("is manager/admin only", async () => {
    state.role = "member"; expect((await call()).status).toBe(403);
    state.role = null; expect((await call()).status).toBe(403);
    expect(ops).toEqual([]);
  });
  it("rejects bad input with 400", async () => { expect((await call({ file_id: "nope" })).status).toBe(400); });
  it("404 for an unknown file, 409 if the file is not in the Recovery Bin (nothing touched)", async () => {
    state.file = null; expect((await call()).status).toBe(404);
    state.file = { id: FILE_ID, name: "a", storage_path: null, google_file_id: null }; state.inBin = false;
    expect((await call()).status).toBe(409); expect(ops).toEqual([]);
  });
  it("erases bytes first, then database rows, then audits", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(ops).toEqual(["google:delete", "storage:remove", "delete:approvals", "update:audit_logs", "delete:recovery_bin", "delete:file_index", "audit"]);
  });
  it("a Google failure aborts before any database row is touched", async () => {
    state.googleErr = new Error("quota exceeded");
    const r = await call();
    expect(r.status).toBe(502);
    expect(ops).toEqual(["google:delete"]); // nothing else touched — safe to retry
  });
  it("a Storage failure after Google is safe to retry (nothing in the database changed)", async () => {
    state.storageErr = "bucket unavailable"; const r = await call(); expect(r.status).toBe(502); expect(ops).toEqual(["google:delete", "storage:remove"]);
  });
  it("a Google 'not found' (already gone) still completes", async () => {
    state.googleErr = new Error("File not found: g1"); expect((await call()).status).toBe(200);
  });
  it("an unreachable Google account aborts safely", async () => {
    state.ctx = false; expect((await call()).status).toBe(502); expect(ops).toEqual([]); // refused before deleting anything
  });
});
