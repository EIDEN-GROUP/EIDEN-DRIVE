import { describe, expect, it, vi, beforeEach } from "vitest";

// POST /api/tags/assign with folder inheritance: assigning a folder tag
// writes exactly ONE direct row (descendants inherit at read time — no
// fan-out) and reports the descendant scope; items outside the caller's
// usable space stay 403, so tags never become an access-escalation path.

function q(result: { data?: unknown; error?: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  c.select = () => c; c.eq = () => c; c.in = () => c; c.limit = () => c;
  c.upsert = async () => ({ error: null });
  c.delete = () => c;
  c.maybeSingle = async () => ({ data: result.data ?? null, error: result.error ?? null });
  c.then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? null }).then(res);
  return c;
}

const state = {
  me: { id: "m1", role: "member", username: "sam" },
  mode: "one" as "one" | "list",
  tag: { id: "tag-1", name: "Clients" },
  folder: { id: "11111111-1111-4111-8111-111111111111", name: "Clients" } as Record<string, unknown> | null,
  file: null as Record<string, unknown> | null,
  foldersAll: [] as { id: string; parent: string | null }[],
  fileCount: 0,
  usable: true,
  writes: [] as string[],
};

vi.mock("@/lib/roles", () => ({ getProfile: async () => state.me }));
vi.mock("@/lib/audit", () => ({ logAudit: async () => {} }));
vi.mock("@/lib/drive-accounts", () => ({ getAccounts: async () => [] }));
vi.mock("@/lib/visibility", async () => {
  const real = await vi.importActual<typeof import("@/lib/visibility")>("@/lib/visibility");
  return {
    ...real,
    canTouch: async () => ({ ok: true }),
    folderUsable: async () => (state.usable ? { ok: true } : { ok: false, reason: "not allowed" }),
    googleInScope: async () => true,
  };
});
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({
    from: (t: string) => {
      if (t === "tags") return q({ data: state.tag });
      if (t === "folders") return q({ data: state.mode === "one" ? state.folder : state.foldersAll });
      if (t === "file_index") {
        return state.mode === "one"
          ? q({ data: state.file })
          : q({ data: null, count: state.fileCount });
      }
      if (t === "folder_tags" || t === "file_tags") {
        state.writes.push(t);
        return q({ data: null });
      }
      return q({ data: null });
    },
  }),
}));

import { POST } from "@/app/api/tags/assign/route";

const FOLDER_ID = "11111111-1111-4111-8111-111111111111";
const TAG_ID = "22222222-2222-4222-8222-222222222222";

function req(body: Record<string, unknown>): Request {
  return new Request("http://x/api/tags/assign", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("POST /api/tags/assign (inheritance)", () => {
  beforeEach(() => {
    Object.assign(state, {
      mode: "one", usable: true, fileCount: 0, foldersAll: [], file: null, writes: [],
    });
  });

  it("folder assign writes ONE direct row and reports the descendant scope", async () => {
    state.mode = "list";
    state.foldersAll = [
      { id: FOLDER_ID, parent: null },
      { id: "child", parent: FOLDER_ID },
      { id: "grand", parent: "child" },
    ];
    state.fileCount = 7;
    const r = await POST(req({ kind: "folder", id: FOLDER_ID, tag_id: TAG_ID, on: true }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, affected: { folders: 2, files: 7 } });
    // Exactly one write — descendants inherit at read time, no fan-out.
    expect(state.writes).toEqual(["folder_tags"]);
  });

  it("unusable folders stay 403 (no tag-escalation path)", async () => {
    state.usable = false;
    const r = await POST(req({ kind: "folder", id: FOLDER_ID, tag_id: TAG_ID, on: true }));
    expect(r.status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("file assigns still work with no scope report for untagged pins", async () => {
    state.file = { id: "33333333-3333-4333-8333-333333333333", name: "a.pdf" };
    const r = await POST(req({ kind: "file", id: state.file.id as string, tag_id: TAG_ID, on: true }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
    expect(state.writes).toEqual(["file_tags"]);
  });
});
