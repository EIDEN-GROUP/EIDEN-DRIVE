import { beforeEach, describe, expect, it, vi } from "vitest";

// Department-tag inheritance through folder ancestry (REAL visibility logic,
// in-memory DB): a matching member works with files/folders at every depth;
// other departments stay denied; Confidential and conflicting tags still win;
// Drive rows inherit through owned/tagged Drive ancestry; cross-account
// ancestors grant nothing.

const ME = "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm";
const TAG = "tag-clients-000000000001";
const F_DEPT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const F_SUB = "11111111-1111-4111-8111-111111111111";
const F_DEEP = "22222222-2222-4222-8222-222222222222";
const F_CONF = "33333333-3333-4333-8333-333333333333";
const F_LEGAL = "44444444-4444-4333-8333-444444444444";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Row = Record<string, unknown>;
const state = {
  meDept: "Clients" as string | null,
  folders: [] as Row[],
  files: [] as Row[],
  fileTags: [] as { file_id: string; tag_id: string; tag_name: string }[],
  folderTags: [] as { folder_id: string; tag_id: string }[],
  tags: [] as { id: string; name: string }[],
  folderBin: [] as { folder_id: string }[],
};

function table(name: string): any {
  const filters: { col: string; val?: unknown; vals?: unknown[] }[] = [];
  let ilike: { col: string; needle: string } | null = null;
  const match = (r: Row) =>
    filters.every((f) =>
      f.vals !== undefined ? (f.vals as unknown[]).includes(r[f.col]) : r[f.col] === f.val) &&
    (!ilike || String(r[ilike.col] ?? "").toLowerCase().includes(ilike.needle));
  const store = (): Row[] => {
    if (name === "folders") return state.folders;
    if (name === "file_index") return state.files;
    if (name === "folder_bin") return state.folderBin;
    if (name === "tags") return state.tags as Row[];
    if (name === "file_tags") return state.fileTags as Row[];
    if (name === "folder_tags") return state.folderTags as Row[];
    return [];
  };
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return q; },
    is: () => q,
    // Faithful substring match (patterns arrive as %needle%): accessContext
    // depends on it to decide strict vs fallback per department.
    ilike: (col: string, pat: unknown) => {
      const needle = String(pat ?? "").replace(/%/g, "").toLowerCase();
      ilike = { col, needle };
      return q;
    },
    in: (col: string, vals: unknown[]) => { filters.push({ col, vals }); return q; },
    limit: () => q,
    order: () => q,
    range: () => q,
    head: () => q,
    then: (res: (v: unknown) => unknown) => {
      let rows = store().filter(match);
      if (name === "file_tags") {
        // Emulate the tags!inner(name) join the route relies on.
        rows = (rows as unknown as typeof state.fileTags[]).map((r) => ({ ...r, tags: { name: (r as unknown as { tag_name: string }).tag_name } }));
      }
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(res);
    },
    maybeSingle: async () => ({ data: store().find(match) ?? null }),
  };
  return q;
}

vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: table }),
}));

import { adminClient } from "@/lib/supabase-admin";
import { accessContext, canTouch, folderUsable, googleAncestryGranted, googlePinOf } from "@/lib/visibility";

const me = () => ({ id: ME, role: "member", department_tag: state.meDept });

function seed() {
  state.meDept = "Clients";
  state.tags = [{ id: TAG, name: "Clients" }];
  state.folderTags = [{ folder_id: F_DEPT, tag_id: TAG }];
  state.folders = [
    { id: F_DEPT, dept: "Clients", classification: "Internal", parent: null },
    { id: F_SUB, dept: null, classification: "Internal", parent: F_DEPT },
    { id: F_DEEP, dept: null, classification: "Internal", parent: F_SUB },
    { id: F_CONF, dept: null, classification: "Confidential", parent: F_DEPT },
    { id: F_LEGAL, dept: "Legal", classification: "Internal", parent: null },
  ];
  state.files = [
    { id: "deep-file", owner: "someone", folder: F_DEEP, google_file_id: null, drive_account_id: null },
    { id: "conf-file", owner: "someone", folder: F_CONF, google_file_id: null, drive_account_id: null },
    { id: "legal-file", owner: "someone", folder: F_LEGAL, google_file_id: null, drive_account_id: null },
  ];
  state.fileTags = [];
  state.folderBin = [];
}

describe("department inheritance (strict tag mode)", () => {
  beforeEach(seed);

  it("matching member touches files three levels deep", async () => {
    const db = adminClient();
    const ctx = await accessContext(db, me());
    expect(ctx.strict).toBe(true);
    expect(ctx.folders).not.toBeNull();
    expect(ctx.folders!.has(F_DEEP)).toBe(true);
    const gate = await canTouch(db, me(), { id: "deep-file", owner: "someone", folder: F_DEEP });
    expect(gate).toMatchObject({ ok: true });
    expect(await folderUsable(db, me(), F_DEEP)).toMatchObject({ ok: true });
  });

  it("other-department member is denied throughout the subtree", async () => {
    state.meDept = "Legal";
    const db = adminClient();
    // Legal's own tag is unassigned → fallback; Clients subtree still denied.
    const gate = await canTouch(db, me(), { id: "deep-file", owner: "someone", folder: F_DEEP });
    expect(gate.ok).toBe(false);
    expect(await folderUsable(db, me(), F_DEEP)).toMatchObject({ ok: false });
    expect(await folderUsable(db, me(), F_DEPT)).toMatchObject({ ok: false });
  });

  it("conflicting file tags deny even inside a visible folder", async () => {
    state.fileTags = [{ file_id: "deep-file", tag_id: "tag-legal", tag_name: "Legal" }];
    const db = adminClient();
    const gate = await canTouch(db, me(), { id: "deep-file", owner: "someone", folder: F_DEEP });
    expect(gate).toMatchObject({ ok: false });
  });

  it("confidential nested folders never inherit", async () => {
    const db = adminClient();
    const ctx = await accessContext(db, me());
    expect(ctx.folders!.has(F_CONF)).toBe(false);
    const gate = await canTouch(db, me(), { id: "conf-file", owner: "someone", folder: F_CONF });
    expect(gate.ok).toBe(false);
  });

  it("binned folders grant nothing and refuse destinations", async () => {
    state.folderBin = [{ folder_id: F_SUB }];
    const db = adminClient();
    const ctx = await accessContext(db, me());
    expect(ctx.folders!.has(F_SUB)).toBe(false);
    expect(ctx.folders!.has(F_DEEP)).toBe(false);
    expect(await folderUsable(db, me(), F_SUB)).toMatchObject({ ok: false });
    expect(await folderUsable(db, me(), F_SUB, { allowBinned: true })).toMatchObject({ ok: true });
  });
});

describe("drive ancestry inheritance", () => {
  beforeEach(() => {
    seed();
    // Drive tree: gd-root (tagged Clients) → gd-sub → gd-file.
    state.files.push(
      { id: "gd-root", owner: "someone", folder: null, google_file_id: "gd-root", google_parent_id: "scope-root", drive_account_id: ACC },
      { id: "gd-sub", owner: "someone", folder: null, google_file_id: "gd-sub", google_parent_id: "gd-root", drive_account_id: ACC },
      { id: "gd-file", owner: "someone", folder: null, google_file_id: "gd-file", google_parent_id: "gd-sub", drive_account_id: ACC },
      { id: "gd-lonely", owner: "someone", folder: null, google_file_id: "gd-lonely", google_parent_id: "scope-root", drive_account_id: ACC },
    );
    state.fileTags.push({ file_id: "gd-root", tag_id: TAG, tag_name: "Clients" });
  });

  it("grants files nested under a tagged drive folder at any depth", async () => {
    const db = adminClient();
    const gate = await canTouch(db, me(),
      { id: "gd-file", owner: "someone", folder: null },
      googlePinOf({ google_file_id: "gd-file", google_parent_id: "gd-sub", drive_account_id: ACC }));
    expect(gate).toMatchObject({ ok: true });
  });

  it("denies drive files with no owned/tagged ancestor (strict)", async () => {
    const db = adminClient();
    const gate = await canTouch(db, me(),
      { id: "gd-lonely", owner: "someone", folder: null },
      googlePinOf({ google_file_id: "gd-lonely", google_parent_id: "scope-root", drive_account_id: ACC }));
    expect(gate.ok).toBe(false);
  });

  it("does not grant across accounts", async () => {
    const db = adminClient();
    const granted = await googleAncestryGranted(db, me(), new Set([TAG]),
      { file_id: "gd-file", parent_id: "gd-sub", account_id: "other-account" });
    expect(granted).toBe(false);
  });

  it("grants via owned drive ancestors", async () => {
    state.files.find((f) => f.id === "gd-sub")!.owner = ME;
    const db = adminClient();
    const granted = await googleAncestryGranted(db, me(), new Set(),
      { file_id: "gd-file", parent_id: "gd-sub", account_id: ACC });
    expect(granted).toBe(true);
  });
});
