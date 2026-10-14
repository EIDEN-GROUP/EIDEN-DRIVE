import { describe, expect, it, vi, beforeEach } from "vitest";

// GET /api/tags must supply COMPLETE ancestor inputs for read-time
// inheritance: folder_tags + folder parents paginated to completion (a
// truncated supply would silently drop descendants), and google-folder rows
// with their direct tags fetched explicitly (past the file_tags cap).

const state = {
  tags: [{ id: "t1", name: "Clients", color: "#111111", created_by: null }],
  fileTags: [{ file_id: "f1", tag_id: "t1" }],
  folderTagPages: [] as { folder_id: string; tag_id: string }[][],
  folderPages: [] as { id: string; parent: string | null }[][],
  googleFolders: [] as { id: string; google_file_id: string; google_parent_id: string | null; drive_account_id: string | null }[],
  googleFileTags: [] as { file_id: string; tag_id: string }[],
};
const pageIdx = { folder_tags: 0, folders: 0 };

vi.mock("@/lib/roles", () => ({ getProfile: async () => ({ id: "m", role: "member" }) }));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({
    from: (t: string) => ({
      select: () => ({
        order: () => ({ limit: async () => ({ data: state.tags, error: null }) }),
        limit: async () => ({ data: t === "file_index" ? state.googleFolders : state.fileTags, error: null }),
        eq: () => ({ limit: async () => ({ data: state.googleFolders, error: null }) }),
        range: async () => {
          const pages = t === "folder_tags" ? state.folderTagPages : state.folderPages;
          const i = t === "folder_tags" ? pageIdx.folder_tags++ : pageIdx.folders++;
          return { data: pages[i] ?? [], error: null };
        },
        in: async () => ({ data: state.googleFileTags, error: null }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/tags/route";

describe("GET /api/tags (inheritance supply)", () => {
  beforeEach(() => {
    Object.assign(state, {
      fileTags: [{ file_id: "f1", tag_id: "t1" }],
      folderTagPages: [[{ folder_id: "clients", tag_id: "t1" }]],
      folderPages: [[
        { id: "clients", parent: null },
        { id: "client-a", parent: "clients" },
      ]],
      googleFolders: [{ id: "grow", google_file_id: "GROOT", google_parent_id: null, drive_account_id: "A1" }],
      googleFileTags: [{ file_id: "grow", tag_id: "t1" }],
    });
    pageIdx.folder_tags = 0;
    pageIdx.folders = 0;
  });

  it("returns direct maps plus complete ancestry inputs", async () => {
    const j = await (await GET()).json();
    expect(j.files).toMatchObject({ f1: ["t1"] });
    expect(j.folders).toMatchObject({ clients: ["t1"] });
    expect(j.folderParents).toMatchObject({ clients: null, "client-a": "clients" });
    expect(j.googleFolders).toMatchObject([{ id: "grow", google_id: "GROOT" }]);
  });

  it("reads folder_tags to completion across pages (no silent truncation)", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ folder_id: `f${i}`, tag_id: "t1" }));
    state.folderTagPages = [full, [{ folder_id: "last", tag_id: "t1" }]];
    const j = await (await GET()).json();
    expect(j.folders["last"]).toEqual(["t1"]);
    expect(Object.keys(j.folders)).toHaveLength(1001);
  });

  it("google-folder ancestor tags survive the file_tags cap", async () => {
    state.fileTags = []; // capped page missed them entirely
    const j = await (await GET()).json();
    expect(j.files).toMatchObject({ grow: ["t1"] });
  });
});
