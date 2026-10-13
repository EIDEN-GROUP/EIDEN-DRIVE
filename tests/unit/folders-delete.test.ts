import { beforeEach, describe, expect, it, vi } from "vitest";

// DELETE /api/folders trash semantics (real visibility logic):
// members trash dept-authorized subtrees, folders are KEPT with folder_bin
// markers (restorable), files are binned in place (never re-homed), purge is
// managers-only and destroys binned subtrees, dead drives fail closed.

const ME = "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm";
const FOLDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUB_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const state = {
  role: "member" as "admin" | "manager" | "member" | null,
  meDept: "Clients" as string | null,
  folders: [] as { id: string; name: string; parent: string | null; dept: string | null; classification?: string | null }[],
  files: [] as { id: string; folder: string | null; google_file_id: string | null; drive_account_id: string | null; owner?: string | null; storage_path?: string | null; storage_bucket?: string | null; name?: string; mime?: string; size?: number; hash?: string | null; backends?: string[] }[],
  bin: [] as { file_id: string; deleted_by: string }[],
  folderBin: [] as { folder_id: string; deleted_by: string }[],
  googleErr: null as null | Error,
  deadDrive: false,
};
const ops: string[] = [];

function table(name: string): any {
  const filters: { col: string; val?: unknown; vals?: unknown[] }[] = [];
  const match = (r: Record<string, unknown>) =>
    filters.every((f) =>
      f.vals !== undefined ? (f.vals as unknown[]).includes(r[f.col]) : r[f.col] === f.val
    );
  const store = () =>
    name === "folders" ? (state.folders as Record<string, unknown>[])
    : name === "file_index" ? (state.files as Record<string, unknown>[])
    : name === "recovery_bin" ? (state.bin as Record<string, unknown>[])
    : name === "folder_bin" ? (state.folderBin as Record<string, unknown>[])
    : [];
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return q; },
    is: () => q,
    ilike: () => q,
    in: (col: string, vals: unknown[]) => { filters.push({ col, vals }); return q; },
    limit: () => q,
    order: () => q,
    range: () => q,
    then: (res: any) => Promise.resolve({ data: store().filter(match), error: null }).then(res),
    update: (patch: Record<string, unknown>) => ({
      eq: async (col: string, val: unknown) => {
        filters.push({ col, val });
        for (const r of store()) if (match(r)) Object.assign(r, patch);
        ops.push(`update:${name}`);
        return { error: null };
      },
      in: async (col: string, vals: unknown[]) => {
        filters.push({ col, vals });
        for (const r of store()) if (match(r)) Object.assign(r, patch);
        ops.push(`update:${name}`);
        return { error: null };
      },
    }),
    delete: () => ({
      eq: async (col: string, val: unknown) => {
        filters.push({ col, val });
        const keep = store().filter((r) => !match(r));
        if (name === "folders") state.folders = keep as typeof state.folders;
        if (name === "file_index") state.files = keep as typeof state.files;
        if (name === "recovery_bin") state.bin = keep as typeof state.bin;
        if (name === "folder_bin") state.folderBin = keep as typeof state.folderBin;
        ops.push(`delete:${name}`);
        return { error: null };
      },
      in: async (col: string, vals: unknown[]) => {
        filters.push({ col, vals });
        const keep = store().filter((r) => !match(r));
        if (name === "folders") state.folders = keep as typeof state.folders;
        if (name === "file_index") state.files = keep as typeof state.files;
        if (name === "recovery_bin") state.bin = keep as typeof state.bin;
        if (name === "folder_bin") state.folderBin = keep as typeof state.folderBin;
        ops.push(`delete:${name}`);
        return { error: null };
      },
    }),
    upsert: async (row: Record<string, unknown> | Record<string, unknown>[]) => {
      ops.push(`upsert:${name}`);
      for (const r of Array.isArray(row) ? row : [row]) {
        if (name === "recovery_bin" && !state.bin.some((b) => b.file_id === r.file_id)) {
          state.bin.push(r as { file_id: string; deleted_by: string });
        }
        if (name === "folder_bin" && !state.folderBin.some((b) => b.folder_id === r.folder_id)) {
          state.folderBin.push(r as { folder_id: string; deleted_by: string });
        }
      }
      return { error: null };
    },
    maybeSingle: async () => {
      const hit = store().find(match);
      return { data: hit ? { ...hit } : null };
    },
    single: async () => {
      const hit = store().find(match);
      return hit ? { data: { ...hit }, error: null } : { data: null, error: { message: "no row" } };
    },
  };
  return q;
}

vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => (state.role ? { id: ME, username: "mem", role: state.role, department_tag: state.meDept } : null) };
});
vi.mock("@/lib/audit", () => ({ logAudit: async () => { ops.push("audit"); } }));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: table, storage: { from: () => ({ remove: async () => ({ error: null }) }) } }),
}));
vi.mock("@/lib/drive-accounts", async () => {
  const real = await vi.importActual<typeof import("@/lib/drive-accounts")>("@/lib/drive-accounts");
  return {
    ...real,
    driveCtxFor: async () => ({ drive: {}, rootId: "", label: "D" }),
    driveGoneReason: async () => (state.deadDrive
      ? { error: "chosen drive is disabled", code: "drive_disabled", status: 410 }
      : null),
  };
});
vi.mock("@/lib/google-drive", () => ({
  rootFor: async () => ({ kind: "mydrive", id: "root" }),
  googleErrorMessage: (m: string) => m,
  trashDriveFile: async () => {
    ops.push("google:trash");
    if (state.googleErr) throw state.googleErr;
    return {};
  },
  deleteDriveFile: async () => { ops.push("google:delete"); return {}; },
}));
// Real visibility (folderUsable/accessContext/canTouch/binnedFolderIds) —
// the mock DB above serves every table those helpers read.

import { DELETE } from "@/app/api/folders/route";

const call = (body: unknown = { folder_id: FOLDER }) =>
  DELETE(new Request("http://x/api/folders", { method: "DELETE", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe("DELETE /api/folders (trash + purge)", () => {
  beforeEach(() => {
    ops.length = 0;
    Object.assign(state, {
      role: "member", meDept: "Clients", googleErr: null, deadDrive: false,
      folders: [
        { id: FOLDER, name: "A", parent: null, dept: "Clients" },
        { id: SUB_B, name: "B", parent: FOLDER, dept: null },
        { id: SUB_C, name: "C", parent: SUB_B, dept: null },
        { id: OTHER, name: "Other", parent: null, dept: "Legal" },
      ],
      files: [
        { id: "file1", folder: SUB_B, google_file_id: null, drive_account_id: null, owner: ME },
        { id: "file2", folder: SUB_C, google_file_id: "g2", drive_account_id: "acc", owner: "someone" },
        { id: "file3", folder: FOLDER, google_file_id: null, drive_account_id: null, owner: ME },
      ],
      bin: [{ file_id: "file3", deleted_by: ME }],
      folderBin: [],
    });
  });

  it("members trash dept-authorized subtrees (folders kept + marked, files binned in place)", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, folders: 3 });
    // Folder rows survive with markers (restorable) — nothing re-homed.
    expect(state.folders.map((f) => f.id).sort()).toEqual([FOLDER, SUB_B, SUB_C, OTHER].sort());
    expect(state.folderBin.map((b) => b.folder_id).sort()).toEqual([FOLDER, SUB_B, SUB_C].sort());
    // Live files binned; already-binned file3 untouched (no duplicate row).
    expect(state.bin.filter((b) => b.file_id === "file1")).toHaveLength(1);
    expect(state.bin.filter((b) => b.file_id === "file2")).toHaveLength(1);
    expect(state.bin.filter((b) => b.file_id === "file3")).toHaveLength(1);
    // Google side trashed for the hybrid; files NOT re-homed.
    expect(ops).toContain("google:trash");
    for (const f of state.files) expect([SUB_B, SUB_C, FOLDER]).toContain(f.folder);
    expect(ops).toContain("audit");
  });

  it("members are refused for other departments' folders (nothing touched)", async () => {
    const r = await call({ folder_id: OTHER });
    expect(r.status).toBe(403);
    expect(state.folderBin).toHaveLength(0);
    expect(state.bin).toHaveLength(1); // only pre-existing file3
    expect(state.folders).toHaveLength(4);
  });

  it("409s already-binned folders", async () => {
    state.folderBin = [{ folder_id: FOLDER, deleted_by: ME }];
    const r = await call();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "already_binned" });
  });

  it("dead drive fails closed per file (folder markers stay, retry resumes)", async () => {
    state.deadDrive = true;
    const r = await call();
    expect(r.status).toBe(410);
    expect(await r.json()).toMatchObject({ code: "drive_disabled" });
    // file2's bin row rolled back; folder markers (retry-safe upserts) remain.
    expect(state.bin.some((b) => b.file_id === "file2")).toBe(false);
    expect(state.folderBin.map((b) => b.folder_id)).toContain(FOLDER);
    expect(state.folders).toHaveLength(4);
  });

  it("purge is managers-only and destroys binned subtrees", async () => {
    state.role = "member";
    expect((await call({ folder_id: FOLDER, purge: true })).status).toBe(403);
    state.role = "manager";
    // Live folder: trash first.
    expect((await call({ folder_id: FOLDER, purge: true })).status).toBe(409);
    // Trash, then purge.
    expect((await call()).status).toBe(200);
    const r = await call({ folder_id: FOLDER, purge: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, folders: 3, purged: 3 });
    expect(state.folders.map((f) => f.id)).toEqual([OTHER]);
    expect(state.files).toHaveLength(0);
    expect(state.bin).toHaveLength(0);
    expect(state.folderBin).toHaveLength(0);
    expect(ops).toContain("google:delete");
  });

  it("purge skips individually-restored (live) files instead of force-purging", async () => {
    state.role = "manager";
    expect((await call()).status).toBe(200);
    // file1 restored on its own before the folder purge.
    state.bin = state.bin.filter((b) => b.file_id !== "file1");
    const r = await call({ folder_id: FOLDER, purge: true });
    expect(await r.json()).toMatchObject({ ok: true, purged: 2, skipped_live: 1 });
    expect(state.files.some((f) => f.id === "file1")).toBe(true);
  });

  it("404s unknown folders without touching anything", async () => {
    const r = await call({ folder_id: "00000000-0000-4000-8000-000000000000" });
    expect(r.status).toBe(404);
    expect(ops).toEqual([]);
  });
});
