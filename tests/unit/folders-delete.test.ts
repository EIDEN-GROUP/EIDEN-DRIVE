import { beforeEach, describe, expect, it, vi } from "vitest";

// Covers the bin-contents folder delete: subtree walk, live files binned +
// re-homed, already-binned files re-homed without touching their bin rows,
// folders removed deepest-first, and Google-failure rollback.

const state = {
  role: "manager" as "admin" | "manager" | "member" | null,
  folders: [] as { id: string; name: string; parent: string | null }[],
  files: [] as { id: string; folder: string | null; google_file_id: string | null; drive_account_id: string | null }[],
  bin: [] as { file_id: string; deleted_by: string }[],
  googleErr: null as null | Error,
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
    : (state.bin as Record<string, unknown>[]);
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return q; },
    in: (col: string, vals: unknown[]) => { filters.push({ col, vals }); return q; },
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
        ops.push(`delete:${name}`);
        return { error: null };
      },
      in: async (col: string, vals: unknown[]) => {
        filters.push({ col, vals });
        const keep = store().filter((r) => !match(r));
        if (name === "folders") state.folders = keep as typeof state.folders;
        if (name === "file_index") state.files = keep as typeof state.files;
        if (name === "recovery_bin") state.bin = keep as typeof state.bin;
        ops.push(`delete:${name}`);
        return { error: null };
      },
    }),
    upsert: async (row: Record<string, unknown>) => {
      ops.push(`upsert:${name}`);
      if (name === "recovery_bin" && !state.bin.some((b) => b.file_id === row.file_id)) {
        state.bin.push(row as { file_id: string; deleted_by: string });
      }
      return { error: null };
    },
    maybeSingle: async () => {
      const hit = store().find(match);
      return { data: hit ? { ...hit } : null };
    },
  };
  return q;
}

vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => (state.role ? { id: "u1", username: "boss", role: state.role, department_tag: null } : null) };
});
vi.mock("@/lib/audit", () => ({ logAudit: async () => { ops.push("audit"); } }));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: table }),
}));
vi.mock("@/lib/drive-accounts", () => ({ driveCtxFor: async () => ({ drive: {}, rootId: "", label: "D" }) }));
vi.mock("@/lib/google-drive", () => ({
  rootFor: async () => ({ kind: "mydrive", id: "root" }),
  googleErrorMessage: (m: string) => m,
  trashDriveFile: async () => {
    ops.push("google:trash");
    if (state.googleErr) throw state.googleErr;
    return {};
  },
}));

import { DELETE } from "@/app/api/folders/route";

const FOLDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const call = () =>
  DELETE(new Request("http://x/api/folders", { method: "DELETE", body: JSON.stringify({ folder_id: FOLDER }), headers: { "content-type": "application/json" } }));

describe("DELETE /api/folders (bin contents)", () => {
  beforeEach(() => {
    ops.length = 0;
    Object.assign(state, {
      role: "manager", googleErr: null,
      folders: [
        { id: FOLDER, name: "A", parent: null },
        { id: "b", name: "B", parent: FOLDER },
        { id: "c", name: "C", parent: "b" },
        { id: "other", name: "Other", parent: null },
      ],
      files: [
        { id: "file1", folder: "b", google_file_id: null, drive_account_id: null },
        { id: "file2", folder: "c", google_file_id: "g2", drive_account_id: "acc" },
        { id: "file3", folder: FOLDER, google_file_id: null, drive_account_id: null },
      ],
      bin: [{ file_id: "file3", deleted_by: "u1" }],
    });
  });

  it("is managers-only", async () => {
    state.role = "member";
    expect((await call()).status).toBe(403);
    expect(ops).toEqual([]);
  });

  it("bins live subtree files, re-homes everything to the parent, removes folders deepest-first", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, folders: 3, binned: 2 });
    // Live files binned; already-binned file3 untouched (no duplicate row).
    expect(state.bin.filter((b) => b.file_id === "file1")).toHaveLength(1);
    expect(state.bin.filter((b) => b.file_id === "file2")).toHaveLength(1);
    expect(state.bin.filter((b) => b.file_id === "file3")).toHaveLength(1);
    // Google side trashed for the hybrid.
    expect(ops).toContain("google:trash");
    // Every file re-homed to A's parent (null); subtree folders gone, Other kept.
    for (const f of state.files) expect(f.folder).toBeNull();
    expect(state.folders.map((f) => f.id)).toEqual(["other"]);
    expect(ops).toContain("audit");
  });

  it("rolls back the bin row when the Google trash fails (nothing deleted)", async () => {
    state.googleErr = new Error("quota exceeded");
    const r = await call();
    expect(r.status).toBe(502);
    // file2's bin row was rolled back; file1 (local, done earlier) stays binned.
    expect(state.bin.some((b) => b.file_id === "file2")).toBe(false);
    // Folders untouched — safe to retry.
    expect(state.folders).toHaveLength(4);
  });

  it("404s unknown folders without touching anything", async () => {
    const r = await DELETE(
      new Request("http://x/api/folders", { method: "DELETE", body: JSON.stringify({ folder_id: "00000000-0000-4000-8000-000000000000" }), headers: { "content-type": "application/json" } })
    );
    expect(r.status).toBe(404);
    expect(ops).toEqual([]);
  });
});
