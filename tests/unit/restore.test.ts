import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/drive/restore with REAL permission/scope logic (in-memory DB):
// member file restore (own + dept-inherited), other-dept denial, not-binned
// refusal, dead-drive fail-closed, out-of-scope refusal, folder subtree
// restore (hierarchy preserved, no dupes, parent rules), purge stays
// manager-only (covered in folders-delete + purge suites).

const ME = "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOT = "drive-root-000000000001";
const F_DEPT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const F_SUB = "11111111-1111-4111-8111-111111111111";
const F_OTHER = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
const state = {
  role: "member" as "admin" | "manager" | "member" | null,
  meDept: "Clients" as string | null,
  files: [] as Row[],
  bin: [] as { file_id: string }[],
  folders: [] as Row[],
  folderBin: [] as { folder_id: string }[],
  tags: [{ id: "tag-c", name: "Clients" }] as { id: string; name: string }[],
  fileTags: [] as { file_id: string; tag_id: string; tag_name: string }[],
  folderTags: [{ folder_id: F_DEPT, tag_id: "tag-c" }] as { folder_id: string; tag_id: string }[],
  accounts: {} as Record<string, { id: string; label: string; email: string | null; refresh_token: string; root_id: string | null; status: string; priority: number }>,
  liveParents: new Set<string>(),
  restoredDrive: [] as string[],
  driveFail: false,
};
const ops: string[] = [];

function table(name: string): any {
  const filters: { col: string; val?: unknown; vals?: unknown[]; notNull?: boolean }[] = [];
  let ilike: { col: string; needle: string } | null = null;
  const match = (r: Row) =>
    filters.every((f) =>
      f.notNull ? r[f.col] != null
      : f.vals !== undefined ? (f.vals as unknown[]).includes(r[f.col])
      : r[f.col] === f.val) &&
    (!ilike || String(r[ilike.col] ?? "").toLowerCase().includes(ilike.needle));
  const store = (): Row[] => {
    if (name === "file_index") return state.files;
    if (name === "recovery_bin") return state.bin as Row[];
    if (name === "folders") return state.folders;
    if (name === "folder_bin") return state.folderBin as Row[];
    if (name === "tags") return state.tags as Row[];
    if (name === "file_tags") return state.fileTags as Row[];
    if (name === "folder_tags") return state.folderTags as Row[];
    if (name === "drive_accounts") return Object.values(state.accounts) as Row[];
    return [];
  };
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return q; },
    is: () => q,
    not: (col: string, op: string, val: unknown) => { if (op === "is" && val === null) filters.push({ col, notNull: true }); return q; },
    ilike: (col: string, pat: unknown) => { ilike = { col, needle: String(pat ?? "").replace(/%/g, "").toLowerCase() }; return q; },
    in: (col: string, vals: unknown[]) => { filters.push({ col, vals }); return q; },
    limit: () => q,
    order: () => q,
    range: () => q,
    then: (res: (v: unknown) => unknown) => {
      let rows = store().filter(match);
      if (name === "file_tags") rows = (rows as unknown as { tag_name: string }[]).map((r) => ({ ...r, tags: { name: r.tag_name } }));
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(res);
    },
    maybeSingle: async () => {
      let rows = store().filter(match);
      if (name === "file_tags") rows = (rows as unknown as { tag_name: string }[]).map((r) => ({ ...r, tags: { name: r.tag_name } }));
      return { data: rows[0] ?? null };
    },
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: "new" }, error: null }) }) }),
    update: () => ({ eq: async () => ({ error: null }), in: async () => ({ error: null }) }),
    delete: () => ({
      eq: async (col: string, val: unknown) => {
        filters.push({ col, val });
        if (name === "recovery_bin") state.bin = state.bin.filter((r) => !match(r));
        if (name === "folder_bin") state.folderBin = state.folderBin.filter((r) => !match(r));
        ops.push(`delete:${name}`);
        return { error: null };
      },
      in: async (col: string, vals: unknown[]) => {
        filters.push({ col, vals });
        if (name === "recovery_bin") state.bin = state.bin.filter((r) => !match(r));
        if (name === "folder_bin") state.folderBin = state.folderBin.filter((r) => !match(r));
        ops.push(`delete:${name}`);
        return { error: null };
      },
    }),
    upsert: async () => ({ error: null }),
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
  adminClient: () => ({ from: table }),
}));
vi.mock("@/lib/supabase-server", () => ({ createClient: () => ({ from: table }) }));
vi.mock("@/lib/drive-accounts", async () => {
  const real = await vi.importActual<typeof import("@/lib/drive-accounts")>("@/lib/drive-accounts");
  return {
    ...real,
    driveCtxFor: async (id?: string | null) => {
      const a = id ? state.accounts[id] : null;
      if (!a || a.status !== "active") return null;
      return {
        drive: { files: { get: async ({ fileId }: { fileId: string }) => {
          if (state.driveFail) throw new Error("boom");
          if (!state.liveParents.has(fileId)) throw new Error("not found");
          return { data: { id: fileId } };
        } } },
        rootId: a.root_id ?? "", label: a.label,
      };
    },
  };
});
vi.mock("@/lib/google-drive", () => ({
  restoreDriveFile: async (id: string) => { ops.push(`drive:restore:${id}`); return {}; },
  trashDriveFile: async (id: string) => { ops.push(`drive:trash:${id}`); return {}; },
}));

import { POST } from "@/app/api/drive/restore/route";
import { bustAccountCache, bustSettingsCache } from "@/lib/drive-accounts";

const call = (body: unknown) =>
  POST(new Request("http://x/api/drive/restore", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

const F1 = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const F2 = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const F3 = "33333333-3333-4333-8333-cccccccccccc";

function seed() {
  state.accounts = { [ACC]: { id: ACC, label: "D", email: null, refresh_token: "rt", root_id: ROOT, status: "active", priority: 0 } };
  state.folders = [
    { id: F_DEPT, name: "Clients", parent: null, dept: "Clients", classification: "Internal" },
    { id: F_SUB, name: "Sub", parent: F_DEPT, dept: null, classification: "Internal" },
    { id: F_OTHER, name: "Legal", parent: null, dept: "Legal", classification: "Internal" },
  ];
  state.files = [
    { id: F1, name: "mine.pdf", mime: "application/pdf", size: 1, owner: ME, folder: null, google_file_id: null, google_parent_id: null, drive_account_id: null },
    { id: F2, name: "dept.pdf", mime: "application/pdf", size: 1, owner: "someone", folder: F_SUB, google_file_id: null, google_parent_id: null, drive_account_id: null },
    // Drive file nested under a Clients-tagged Drive folder (ancestry grant).
    { id: "gd-dir", name: "Dept", mime: "application/vnd.google-apps.folder", size: 0, owner: "someone", folder: null, google_file_id: "gd-dir", google_parent_id: ROOT, drive_account_id: ACC },
    { id: F3, name: "g.pdf", mime: "application/pdf", size: 1, owner: "someone", folder: null, google_file_id: "g3", google_parent_id: "gd-dir", drive_account_id: ACC },
  ];
  state.fileTags = [{ file_id: "gd-dir", tag_id: "tag-c", tag_name: "Clients" }];
  state.bin = [{ file_id: F1 }, { file_id: F2 }, { file_id: F3 }];
  state.folderBin = [];
  state.liveParents = new Set([ROOT, "gd-dir"]);
  state.restoredDrive = [];
}

describe("POST /api/drive/restore (members included)", () => {
  beforeEach(() => {
    ops.length = 0;
    Object.assign(state, { role: "member", meDept: "Clients", driveFail: false });
    bustAccountCache();
    bustSettingsCache();
    seed();
  });

  it("members restore their own files", async () => {
    const r = await call({ file_id: F1 });
    expect(r.status).toBe(200);
    expect(state.bin.some((b) => b.file_id === F1)).toBe(false);
    expect(ops).toContain("audit");
  });

  it("matching members restore dept-inherited files at depth", async () => {
    expect((await call({ file_id: F2 })).status).toBe(200);
    expect(state.bin.some((b) => b.file_id === F2)).toBe(false);
  });

  it("other-department members are denied (row stays binned)", async () => {
    state.meDept = "Legal";
    const r = await call({ file_id: F2 });
    expect(r.status).toBe(403);
    expect(state.bin.some((b) => b.file_id === F2)).toBe(true);
  });

  it("409s files that aren't binned", async () => {
    state.bin = [];
    expect((await call({ file_id: F1 })).status).toBe(409);
  });

  it("restores google files with live checks (410s dead drives, 403s out-of-scope)", async () => {
    expect((await call({ file_id: F3 })).status).toBe(200);
    expect(ops).toContain("drive:restore:g3");
    // dead drive
    seed();
    state.accounts[ACC].status = "disabled";
    bustAccountCache();
    expect((await call({ file_id: F3 })).status).toBe(410);
    expect(state.bin.some((b) => b.file_id === F3)).toBe(true);
  });

  it("members restore binned dept folders with hierarchy intact (no dupes, no re-home)", async () => {
    state.folderBin = [{ folder_id: F_SUB }];
    state.bin = state.bin.filter((b) => b.file_id !== F1);
    const r = await call({ folder_id: F_SUB });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, folders: 1, files: 1 });
    expect(state.folderBin).toHaveLength(0);
    expect(state.bin.some((b) => b.file_id === F2)).toBe(false);
    // hierarchy preserved: file still points at the restored folder
    expect(state.files.find((f) => f.id === F2)?.folder).toBe(F_SUB);
    expect(state.folders.some((f) => f.id === F_SUB)).toBe(true);
  });

  it("other-department members cannot restore folders", async () => {
    state.folderBin = [{ folder_id: F_SUB }];
    state.meDept = "Legal";
    expect((await call({ folder_id: F_SUB })).status).toBe(403);
    expect(state.folderBin).toHaveLength(1);
  });

  it("409s when the parent folder is still binned (restore parents first)", async () => {
    state.folderBin = [{ folder_id: F_DEPT }, { folder_id: F_SUB }];
    const r = await call({ folder_id: F_SUB });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "parent_binned" });
  });

  it("re-homes to root with a note when the parent is gone", async () => {
    state.folders = state.folders.filter((f) => f.id !== F_DEPT);
    state.folderBin = [{ folder_id: F_SUB }];
    state.bin = state.bin.filter((b) => b.file_id !== F1);
    const r = await call({ folder_id: F_SUB });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(typeof j.note).toBe("string");
    expect(state.folders.find((f) => f.id === F_SUB)?.parent).toBeNull();
  });

  it("skips ineligible files (counted) while restoring the rest", async () => {
    state.folderBin = [{ folder_id: F_SUB }];
    state.fileTags = [{ file_id: F2, tag_id: "tag-x", tag_name: "Legal" }];
    state.bin = state.bin.filter((b) => b.file_id !== F1);
    const r = await call({ folder_id: F_SUB });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, files: 0, skipped: 1 });
    expect(state.bin.some((b) => b.file_id === F2)).toBe(true);
    expect(state.folderBin).toHaveLength(0);
  });
});
