import { describe, expect, it, vi, beforeEach } from "vitest";

// Folder Slack-mute resolution: explicit rows cascade to descendants at read
// time (Workspace via folders.parent, Drive via same-account google chains),
// cross-account chains never merge, cycles terminate, failures fail closed.

const state = {
  wsMutes: new Set<string>(),
  driveMutes: new Map<string, Set<string>>(),
  parents: {} as Record<string, string | null>,
  gParents: {} as Record<string, string | null>,
  foldersAll: [] as { id: string; name: string; parent: string | null }[],
};

function chain(table: string) {
  const q: Record<string, unknown> = {};
  const eqs: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (c: string, v: unknown) => { eqs[c] = v; return q; };
  q.not = () => q;
  q.in = () => q;
  q.limit = () => q;
  q.maybeSingle = async () => {
    if (table === "folders") {
      const p = state.parents[eqs.id as string];
      return { data: p === undefined ? null : { parent: p } };
    }
    if (table === "file_index") {
      const gp = state.gParents[`${eqs.drive_account_id}:${eqs.google_file_id}`];
      return { data: gp === undefined ? null : { google_parent_id: gp } };
    }
    return { data: null };
  };
  (q as { then: unknown }).then = (res: (v: unknown) => unknown) => {
    let rows: unknown[] = [];
    if (table === "folders") {
      rows = state.foldersAll;
    } else if (table === "folder_slack_mutes") {
      if (eqs.workspace_folder_id) {
        rows = state.wsMutes.has(eqs.workspace_folder_id as string) ? [{ workspace_folder_id: eqs.workspace_folder_id }] : [];
      } else if (eqs.drive_account_id) {
        const set = state.driveMutes.get(eqs.drive_account_id as string) ?? new Set();
        const g = eqs.google_folder_id as string | undefined;
        const ids = g ? [...set].filter((x) => x === g) : [...set];
        rows = ids.map((google_folder_id) => ({ google_folder_id }));
      } else {
        rows = [...state.wsMutes].map((workspace_folder_id) => ({ workspace_folder_id }));
      }
    }
    return Promise.resolve({ data: rows, error: null }).then(res);
  };
  return q;
}

vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({}),
}));

import {
  isMuted, workspaceEffectiveMuted, driveEffectiveMuted, fileSlackMuted,
  workspaceDescendants,
} from "@/lib/folder-slack-mute";

const db = { from: (t: string) => chain(t) } as never;

describe("folder slack mute resolution", () => {
  beforeEach(() => {
    state.wsMutes = new Set();
    state.driveMutes = new Map();
    state.parents = { child: "parent", parent: "grand", grand: null, loop1: "loop2", loop2: "loop1" };
    state.gParents = { "A1:G2": "G1", "A1:G3": "G2", "A1:G1": null };
  });

  it("unmuted folders report false", async () => {
    expect(await isMuted(db, { scope: "workspace", folderId: "parent" })).toBe(false);
    expect(await workspaceEffectiveMuted(db, "child")).toBe(false);
  });

  it("explicit mutes cascade down the workspace ancestry", async () => {
    state.wsMutes.add("grand");
    expect(await workspaceEffectiveMuted(db, "child")).toBe(true);
    expect(await workspaceEffectiveMuted(db, "parent")).toBe(true);
    expect(await workspaceEffectiveMuted(db, "grand")).toBe(true);
    expect(await workspaceEffectiveMuted(db, "unrelated")).toBe(false);
  });

  it("drive mutes cascade within the same account only", async () => {
    state.driveMutes.set("A1", new Set(["G1"]));
    expect(await driveEffectiveMuted(db, "A1", "G3")).toBe(true);
    expect(await driveEffectiveMuted(db, "A1", "G2")).toBe(true);
    expect(await driveEffectiveMuted(db, "A2", "G3")).toBe(false);
    expect(await driveEffectiveMuted(db, "A1", "GX")).toBe(false);
  });

  it("file rows mute via either leg", async () => {
    state.wsMutes.add("parent");
    expect(await fileSlackMuted(db, { folder: "child", google_parent_id: null, drive_account_id: null })).toBe(true);
    state.wsMutes.clear();
    state.driveMutes.set("A1", new Set(["G2"]));
    expect(await fileSlackMuted(db, { folder: null, google_parent_id: "G3", drive_account_id: "A1" })).toBe(true);
    expect(await fileSlackMuted(db, { folder: null, google_parent_id: "G3", drive_account_id: "A2" })).toBe(false);
  });

  it("cycles terminate", async () => {
    expect(await workspaceEffectiveMuted(db, "loop1")).toBe(false);
    state.wsMutes.add("loop2");
    expect(await workspaceEffectiveMuted(db, "loop1")).toBe(true);
  });

  it("lists workspace descendants bounded", async () => {
    state.parents = { a: null, b: "a", c: "b", d: "a" };
    state.foldersAll = [
      { id: "a", name: "a", parent: null },
      { id: "b", name: "b", parent: "a" },
      { id: "c", name: "c", parent: "b" },
      { id: "d", name: "d", parent: "a" },
    ];
    const subs = await workspaceDescendants(db, "a");
    expect(subs.map((s) => s.id).sort()).toEqual(["b", "c", "d"]);
  });
});
