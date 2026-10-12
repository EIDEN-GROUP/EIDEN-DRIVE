import { beforeEach, describe, expect, it, vi } from "vitest";

// Upload-lifecycle scope verification with the REAL decision logic
// (landedFileInScope, requireActiveAccount; rootFor is stubbed only at the
// transport edge). The Drive client is a per-ID metadata map — ancestry,
// driveId and trashed are exercised, never mocked at the verdict level.
//
// Covers: root + nested + deep-nested acceptance, genuinely out-of-scope
// rejection with cleanup, shared-drive match/mismatch, unscoped acceptance,
// trashed landings, duplicate-retry idempotency (pre-existing row AND
// insert-race), disabled/deleted drives, small + >100 MB files.

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const DISABLED = "22222222-2222-4222-8222-222222222222";
const MISSING = "33333333-3333-4333-8333-333333333333";
const ROOT = "scope-root-000000000001";
const SUB = "subfolder00000000000001";
const DEEP = "deepfolder000000000001";
const OTHER = "otherplace000000000001";
const GFILE = "gfile000000000000000001";

type GMeta = { id?: string; name?: string; mimeType?: string; size?: string; parents?: string[]; driveId?: string; trashed?: boolean };

const state = {
  role: "member" as "admin" | "manager" | "member" | null,
  accounts: {} as Record<string, { id: string; label: string; email: string | null; refresh_token: string; root_id: string | null; status: string; priority: number }>,
  root: { kind: "folder", id: ROOT } as { kind: string; id: string },
  driveFiles: {} as Record<string, GMeta>,
  dupRow: null as null | { id: string },
  failNextInsert: false,
  insertThrows: false,
  lastInsert: null as null | Record<string, unknown>,
};
const ops: string[] = [];

function table(name: string): any {
  const filters: Record<string, unknown> = {};
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters[col] = val; return q; },
    maybeSingle: async () => {
      if (name === "drive_accounts") return { data: state.accounts[filters.id as string] ?? null };
      if (name === "file_index") return { data: state.dupRow };
      return { data: null };
    },
    insert: (row: unknown) => {
      ops.push(`insert:${name}`);
      if (name === "file_index") {
        // Concurrent-winner simulation: the insert fails, but the winner's
        // row is visible on the re-read that follows.
        if (state.failNextInsert) {
          state.failNextInsert = false;
          state.dupRow = { id: "file-race" };
          return { select: () => ({ single: async () => ({ data: null, error: { message: "duplicate key" } }) }) };
        }
        if (state.insertThrows) return { select: () => ({ single: async () => ({ data: null, error: { message: "db down" } }) }) };
        state.lastInsert = row as Record<string, unknown>;
        state.dupRow = state.dupRow ?? { id: "file-1" };
      }
      return { select: () => ({ single: async () => ({ data: { id: "file-1" }, error: null }) }) };
    },
  };
  return q;
}

vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => (state.role ? { id: "u1", username: "boss", role: state.role, department_tag: null } : null) };
});
vi.mock("@/lib/audit", () => ({ logAudit: async () => { ops.push("audit"); } }));
vi.mock("@/lib/upload-notify", () => ({ notifyUpload: async () => { ops.push("notify"); } }));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: table }),
}));
vi.mock("@/lib/visibility", async () => {
  const real = await vi.importActual<typeof import("@/lib/visibility")>("@/lib/visibility");
  return { ...real, folderUsable: async () => ({ ok: true }), bustScopeCache: () => { ops.push("bust"); } };
});
vi.mock("@/lib/google-drive", () => ({
  rootFor: async () => state.root,
  deleteDriveFile: async (id: string) => { ops.push(`drive:delete:${id}`); return {}; },
}));
vi.mock("@/lib/drive-accounts", async () => {
  const real = await vi.importActual<typeof import("@/lib/drive-accounts")>("@/lib/drive-accounts");
  return {
    ...real,
    clientFor: () => ({
      files: {
        get: async ({ fileId }: { fileId: string }) => {
          const hit = state.driveFiles[fileId];
          if (!hit) throw new Error("not found: " + fileId);
          return { data: hit };
        },
      },
    }),
    quotaFor: async () => ({ usage: 1, limit: 100, free: 99, email: null }),
  };
});

import { landedFileInScope } from "@/lib/visibility";
import { POST as completeUpload } from "@/app/api/drive/resumable/complete/route";

const post = (body: unknown) =>
  completeUpload(new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

function seedAccounts() {
  state.accounts = {
    [ACTIVE]: { id: ACTIVE, label: "D-active", email: null, refresh_token: "rt", root_id: ROOT, status: "active", priority: 0 },
    [DISABLED]: { id: DISABLED, label: "D-off", email: null, refresh_token: "rt", root_id: ROOT, status: "disabled", priority: 0 },
  };
}
function seedDrive(parents: string[], size = 1048576, extra: Partial<GMeta> = {}) {
  state.driveFiles = {
    [GFILE]: { id: GFILE, name: "up.bin", mimeType: "application/octet-stream", size: String(size), parents, ...extra },
    [SUB]: { id: SUB, parents: [ROOT] },
    [DEEP]: { id: DEEP, parents: [SUB] },
    [OTHER]: { id: OTHER, parents: ["unrelated-root-00000001"] },
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubDrive = () => ({ files: { get: async ({ fileId }: { fileId: string }) => {
  const hit = state.driveFiles[fileId];
  if (!hit) throw new Error("not found");
  return { data: hit };
} } }) as any;

describe("landedFileInScope (real logic, stub transport)", () => {
  beforeEach(() => { seedDrive([ROOT]); });
  it("accepts a direct child of a folder root without extra reads", async () => {
    await expect(landedFileInScope(stubDrive(), { kind: "folder", id: ROOT }, { id: "f", parents: [ROOT] })).resolves.toEqual({ ok: true });
  });
  it("accepts nested + deep-nested ancestry", async () => {
    await expect(landedFileInScope(stubDrive(), { kind: "folder", id: ROOT }, { id: "f", parents: [SUB] })).resolves.toEqual({ ok: true });
    await expect(landedFileInScope(stubDrive(), { kind: "folder", id: ROOT }, { id: "f", parents: [DEEP] })).resolves.toEqual({ ok: true });
  });
  it("refuses ancestry that never reaches the root", async () => {
    await expect(landedFileInScope(stubDrive(), { kind: "folder", id: ROOT }, { id: "f", parents: [OTHER] })).resolves.toMatchObject({ ok: false });
  });
  it("refuses unreadable ancestry (deny-closed)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dead = { files: { get: async () => { throw new Error("boom"); } } } as any;
    await expect(landedFileInScope(dead, { kind: "folder", id: ROOT }, { id: "f", parents: [OTHER] })).resolves.toMatchObject({ ok: false });
  });
  it("shared-drive roots match on driveId only", async () => {
    await expect(landedFileInScope(stubDrive(), { kind: "drive", id: "DD" }, { id: "f", parents: ["any"], driveId: "DD" })).resolves.toEqual({ ok: true });
    await expect(landedFileInScope(stubDrive(), { kind: "drive", id: "DD" }, { id: "f", parents: ["any"], driveId: "XX" })).resolves.toMatchObject({ ok: false });
    await expect(landedFileInScope(stubDrive(), { kind: "drive", id: "DD" }, { id: "f", parents: ["any"] })).resolves.toMatchObject({ ok: false });
  });
  it("unscoped (mydrive) roots accept", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(landedFileInScope(stubDrive(), { kind: "mydrive" } as any, { id: "f", parents: ["anywhere"] })).resolves.toEqual({ ok: true });
  });
});

describe("complete with live scope (real logic end-to-end)", () => {
  beforeEach(() => {
    ops.length = 0;
    Object.assign(state, { role: "member", root: { kind: "folder", id: ROOT }, dupRow: null, failNextInsert: false, insertThrows: false, lastInsert: null });
    seedAccounts();
    seedDrive([ROOT]);
  });
  const body = { driveFileId: GFILE, accountId: ACTIVE, hash: "b".repeat(64) };

  it("indexes a root landing (small file)", async () => {
    seedDrive([ROOT], 1024);
    const r = await post(body);
    expect(r.status).toBe(200);
    expect(state.lastInsert).toMatchObject({ google_file_id: GFILE, google_parent_id: ROOT, drive_account_id: ACTIVE, size: 1024 });
    expect(ops).not.toContain(`drive:delete:${GFILE}`);
  });
  it("indexes a >100 MB landing", async () => {
    seedDrive([ROOT], 157_286_400);
    const r = await post(body);
    expect(r.status).toBe(200);
    expect(state.lastInsert).toMatchObject({ size: 157_286_400 });
  });
  it("indexes a nested landing (immediate parent is the subfolder, not the root)", async () => {
    seedDrive([SUB]);
    const r = await post(body);
    expect(r.status).toBe(200);
    expect(state.lastInsert).toMatchObject({ google_parent_id: SUB });
    expect(ops).not.toContain(`drive:delete:${GFILE}`);
  });
  it("indexes a deep-nested landing", async () => {
    seedDrive([DEEP]);
    expect((await post(body)).status).toBe(200);
  });
  it("rejects + removes a genuinely out-of-scope landing", async () => {
    seedDrive([OTHER]);
    const r = await post(body);
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "out_of_scope" });
    expect(ops).toContain(`drive:delete:${GFILE}`);
  });
  it("rejects + removes a trashed landing", async () => {
    seedDrive([ROOT], 1024, { trashed: true });
    const r = await post(body);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: "trashed_in_drive" });
    expect(ops).toContain(`drive:delete:${GFILE}`);
  });
  it("duplicate retry with existing row returns it (no delete, no insert)", async () => {
    state.dupRow = { id: "file-9" };
    const r = await post(body);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, id: "file-9", deduped: true });
    expect(ops).not.toContain(`drive:delete:${GFILE}`);
    expect(ops).not.toContain("insert:file_index");
  });
  it("insert-race loser re-reads and dedupes instead of deleting the valid file", async () => {
    state.failNextInsert = true;
    const r = await post(body);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, id: "file-race", deduped: true });
    expect(ops).not.toContain(`drive:delete:${GFILE}`);
  });
  it("410s disabled + 404s deleted drives (nothing touched)", async () => {
    expect((await post({ ...body, accountId: DISABLED })).status).toBe(410);
    expect((await post({ ...body, accountId: MISSING })).status).toBe(404);
    expect(ops).not.toContain("insert:file_index");
    expect(ops).not.toContain(`drive:delete:${GFILE}`);
  });
});
