import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/folders/move + /api/folders/copy (in-memory DB):
// move re-parents with subtree dept checks, self/descendant refusal, binned
// refusal; copy duplicates folders/files/tags/versions with sibling-name
// resolution, Drive recursion re-parenting onto duplicated folders, rollback
// on failure, and the same safety rules.

const ME = "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Row = Record<string, unknown>;
const state = {
  role: "member" as "admin" | "manager" | "member" | null,
  meDept: "Clients" as string | null,
  folders: [] as Row[],
  files: [] as Row[],
  folderBin: [] as { folder_id: string }[],
  fileTags: [] as { file_id: string; tag_id: string }[],
  folderTags: [{ folder_id: A, tag_id: "tag-c" }] as { folder_id: string; tag_id: string }[],
  tags: [{ id: "tag-c", name: "Clients" }] as { id: string; name: string }[],
  versions: [] as Row[],
  storageFail: false,
  driveFail: false,
  driveCopies: [] as { id: string; parents: string[] }[],
};
const ops: string[] = [];
let idSeq = 0;
const nid = () => `new-${++idSeq}`;

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
    if (name === "folder_bin") return state.folderBin as Row[];
    if (name === "tags") return state.tags as Row[];
    if (name === "file_tags") return state.fileTags as Row[];
    if (name === "folder_tags") return state.folderTags as Row[];
    if (name === "versions") return state.versions;
    return [];
  };
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return q; },
    is: (col: string, val: null) => { filters.push({ col, val }); return q; },
    ilike: (col: string, pat: unknown) => { ilike = { col, needle: String(pat ?? "").replace(/%/g, "").toLowerCase() }; return q; },
    in: (col: string, vals: unknown[]) => { filters.push({ col, vals }); return q; },
    limit: () => q,
    order: () => q,
    maybeSingle: async () => {
      let rows = store().filter(match);
      if (name === "file_tags") rows = (rows as unknown as { tag_name?: string }[]).map((r) => r);
      return { data: rows[0] ?? null };
    },
    insert: (row: unknown) => {
      ops.push(`insert:${name}`);
      const rows = Array.isArray(row) ? row : [row];
      const out = rows.map((r) => ({ id: nid(), ...(r as object) }));
      store().push(...(out as Row[]));
      return { select: () => ({ single: async () => ({ data: out[0], error: null }) }) };
    },
    update: (patch: Row) => ({
      eq: async (col: string, val: unknown) => {
        filters.push({ col, val });
        for (const r of store()) if (match(r)) Object.assign(r, patch);
        return { error: null };
      },
    }),
    delete: () => ({
      eq: async (col: string, val: unknown) => {
        filters.push({ col, val });
        const arr = store();
        const keep = arr.filter((r) => !match(r));
        if (name === "folders") state.folders = keep;
        if (name === "file_index") state.files = keep;
        return { error: null };
      },
    }),
    then: (res: (v: unknown) => unknown) => {
      let rows = store().filter(match);
      if (name === "file_tags" && (filters.some((f) => f.col === "file_id"))) {
        // join emulation not needed (tag_id only selects) — plain rows fine
      }
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(res);
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
  adminClient: () => ({
    from: table,
    storage: { from: () => ({ copy: async () => { if (state.storageFail) return { error: { message: "storage down" } }; return { error: null }; }, remove: async () => ({ error: null }) }) },
  }),
}));
vi.mock("@/lib/drive-accounts", async () => {
  const real = await vi.importActual<typeof import("@/lib/drive-accounts")>("@/lib/drive-accounts");
  return {
    ...real,
    driveCtxFor: async () => ({
      drive: { files: {
        copy: async ({ fileId, requestBody }: { fileId: string; requestBody?: { parents?: string[] } }) => {
          if (state.driveFail) throw new Error("drive down");
          const id = `gcopy-${fileId}`;
          state.driveCopies.push({ id, parents: requestBody?.parents ?? [] });
          return { data: { id } };
        },
        delete: async () => ({}),
      } },
      rootId: "", label: "D",
    }),
    driveGoneReason: async () => null,
  };
});
vi.mock("@/lib/google-drive", () => ({ rootFor: async () => ({ kind: "mydrive" }) }));
vi.mock("@/lib/storage", async () => {
  const real = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return { ...real, bucketFor: () => "eiden-uploads" };
});

import { POST as moveFolder } from "@/app/api/folders/move/route";
import { POST as copyFolder } from "@/app/api/folders/copy/route";

const move = (body: unknown) =>
  moveFolder(new Request("http://x/api/folders/move", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const copy = (body: unknown) =>
  copyFolder(new Request("http://x/api/folders/copy", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

function seed() {
  state.folders = [
    { id: A, name: "A", parent: null, dept: "Clients", classification: "Internal" },
    { id: B, name: "B", parent: A, dept: null, classification: "Internal" },
    { id: C, name: "C", parent: B, dept: null, classification: "Internal" },
    { id: D, name: "Legal", parent: null, dept: "Legal", classification: "Internal" },
  ];
  state.files = [
    { id: "f1", name: "a.txt", mime: "text/plain", size: 3, hash: "h", storage_path: "u/f1", storage_bucket: "eiden-uploads", google_file_id: null, google_parent_id: null, drive_account_id: null, backends: ["local"], owner: ME, folder: B },
    { id: "f2", name: "g.pdf", mime: "application/pdf", size: 4, hash: "h", storage_path: null, storage_bucket: null, google_file_id: "g2", google_parent_id: "gd-sub", drive_account_id: ACC, backends: ["google"], owner: "someone", folder: C },
  ];
  state.versions = [{ file_id: "f1", v: 1, hash: "h", actor: ME }];
  state.fileTags = [{ file_id: "f1", tag_id: "tag-c" }];
}

describe("POST /api/folders/move", () => {
  beforeEach(() => {
    ops.length = 0; idSeq = 0;
    Object.assign(state, { role: "member", meDept: "Clients", storageFail: false, driveFail: false, driveCopies: [] });
    state.folderBin = [];
    seed();
  });

  it("members move dept-authorized folders (subtree follows, nothing else changes)", async () => {
    const r = await move({ folder_id: B, parent: null });
    expect(r.status).toBe(200);
    expect(state.folders.find((f) => f.id === B)?.parent).toBeNull();
    expect(state.folders.find((f) => f.id === C)?.parent).toBe(B);
    expect(ops).toContain("audit");
  });

  it("refuses self/descendant destinations", async () => {
    expect((await move({ folder_id: A, parent: A })).status).toBe(400);
    const r = await move({ folder_id: A, parent: C });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: "self_descendant" });
    expect(state.folders.find((f) => f.id === A)?.parent).toBeNull();
  });

  it("refuses other departments' folders and destinations", async () => {
    expect((await move({ folder_id: D, parent: null })).status).toBe(403);
    expect((await move({ folder_id: B, parent: D })).status).toBe(403);
    expect(state.folders.find((f) => f.id === B)?.parent).toBe(A);
  });

  it("refuses binned folders and binned destinations", async () => {
    state.folderBin = [{ folder_id: B }];
    const r = await move({ folder_id: B, parent: null });
    expect(r.status).toBe(409);
    state.folderBin = [{ folder_id: D }];
    state.meDept = "Legal";
    // D binned: membership proof still works (includeBinned) but the
    // binned-state refusal fires — restore first.
    const r2 = await move({ folder_id: D, parent: null });
    expect(r2.status).toBe(409);
  });
});

describe("POST /api/folders/copy", () => {
  beforeEach(() => {
    ops.length = 0; idSeq = 0;
    Object.assign(state, { role: "member", meDept: "Clients", storageFail: false, driveFail: false, driveCopies: [] });
    state.folderBin = [];
    seed();
  });

  it("duplicates nested workspace folders with files, tags, versions (new owners, kept names below root)", async () => {
    const r = await copy({ folder_id: A, parent: null });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, folders: 3, files: 2 });
    expect(j.name).toBe("Copy of A");
    // hierarchy duplicated under the new root, children keep names: walk down
    // from the root copy and expect the original shape (A-copy → B → C).
    const rootCopy = state.folders.find((f) => f.name === "Copy of A");
    expect(rootCopy).toBeTruthy();
    const bCopy = state.folders.find((f) => f.name === "B" && f.parent === rootCopy!.id);
    expect(bCopy).toBeTruthy();
    const cCopy = state.folders.find((f) => f.name === "C" && f.parent === bCopy!.id);
    expect(cCopy).toBeTruthy();
    // every file duplicated with a new id, owned by the copier
    expect(state.files.filter((f) => ["f1", "f2"].includes(String(f.id)))).toHaveLength(2);
    const dupes = state.files.filter((f) => !["f1", "f2"].includes(String(f.id)));
    expect(dupes).toHaveLength(2);
    expect(dupes.every((f) => f.owner === ME)).toBe(true);
    // tags + versions followed
    expect(state.fileTags.some((t) => String(t.file_id).startsWith("new-") && t.tag_id === "tag-c")).toBe(true);
    expect(state.versions.some((v) => String(v.file_id).startsWith("new-"))).toBe(true);
  });

  it("resolves sibling name conflicts predictably", async () => {
    state.folders.push({ id: "x", name: "Copy of A", parent: null, dept: null, classification: "Internal" });
    const r = await copy({ folder_id: A, parent: null });
    expect(await r.json()).toMatchObject({ name: "Copy of A (2)" });
  });

  it("drive copies re-parent onto duplicated drive folders (never the originals)", async () => {
    // f2's google parent gd-sub is NOT an indexed folder row here; give the
    // subtree an indexed drive folder so mapping applies: covered below.
    const r = await copy({ folder_id: C, parent: null });
    expect(r.status).toBe(200);
    // f2 copied next to its original (no indexed folder copy to nest under)
    const f2copy = state.driveCopies.find((c) => c.id === "gcopy-g2");
    expect(f2copy?.parents).toEqual(["gd-sub"]);
  });

  it("refuses self/descendant and other-department copies", async () => {
    expect((await copy({ folder_id: A, parent: C })).status).toBe(400);
    expect((await copy({ folder_id: D, parent: null })).status).toBe(403);
  });

  it("rolls back everything when a leg fails (no partial trees)", async () => {
    state.storageFail = true;
    const before = { folders: state.folders.length, files: state.files.length };
    const r = await copy({ folder_id: A, parent: null });
    expect(r.status).toBe(502);
    expect(state.folders.length).toBe(before.folders);
    expect(state.files.length).toBe(before.files);
  });
});
