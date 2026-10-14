import { describe, expect, it } from "vitest";
import { computeEffectiveTags, inheritedFrom, workspaceAncestors } from "@/lib/tag-inheritance";

// Recursive folder-tag inheritance: workspace chains, Google chains (same
// account only), multi-ancestor union without dupes, direct-survives-removal,
// move recalculation, cycle/depth safety, and source tracking.

const T_CLIENTS = "tag-clients";
const T_FINANCE = "tag-finance";

function ws() {
  // Workspace/Clients(t:Clients) → Client A → Contracts; files at each level.
  return {
    fileDirect: {
      "file-root": [],
      "file-a": [],
      "file-deep": ["tag-direct"],
    } as Record<string, string[]>,
    folderDirect: {
      clients: [T_CLIENTS],
      "client-a": [],
      contracts: [],
      finance: [T_FINANCE],
    } as Record<string, string[]>,
    folderParent: { clients: null, "client-a": "clients", contracts: "client-a", finance: null } as Record<string, string | null>,
    googleFolders: [],
    files: [
      { id: "file-root", folder: "clients", google_parent_id: null, drive_account_id: null },
      { id: "file-a", folder: "client-a", google_parent_id: null, drive_account_id: null },
      { id: "file-deep", folder: "contracts", google_parent_id: null, drive_account_id: null },
    ],
  };
}

describe("workspace inheritance", () => {
  it("tags every existing descendant at every depth", () => {
    const eff = computeEffectiveTags(ws());
    expect(eff.files["file-root"]).toContain(T_CLIENTS);
    expect(eff.files["file-a"]).toContain(T_CLIENTS);
    expect(eff.files["file-deep"]).toContain(T_CLIENTS);
    expect(eff.folders["client-a"]).toContain(T_CLIENTS);
    expect(eff.folders["contracts"]).toContain(T_CLIENTS);
  });

  it("unions multiple ancestor tags without duplicates", () => {
    const input = ws();
    input.folderDirect["client-a"] = [T_FINANCE, T_CLIENTS];
    const eff = computeEffectiveTags(input);
    expect(eff.files["file-deep"]).toEqual(expect.arrayContaining([T_CLIENTS, T_FINANCE, "tag-direct"]));
    expect(new Set(eff.files["file-deep"]).size).toBe(eff.files["file-deep"].length);
  });

  it("direct tags survive ancestor removal", () => {
    const before = computeEffectiveTags(ws());
    expect(before.files["file-deep"]).toContain("tag-direct");
    const input = ws();
    input.folderDirect.clients = []; // parent tag removed
    const after = computeEffectiveTags(input);
    expect(after.files["file-deep"]).toContain("tag-direct");
    expect(after.files["file-deep"]).not.toContain(T_CLIENTS);
    expect(after.files["file-a"]).not.toContain(T_CLIENTS);
  });

  it("moving an item recalculates its inherited tags", () => {
    const input = ws();
    input.files.find((f) => f.id === "file-a")!.folder = "finance";
    const eff = computeEffectiveTags(input);
    expect(eff.files["file-a"]).toContain(T_FINANCE);
    expect(eff.files["file-a"]).not.toContain(T_CLIENTS);
  });

  it("sources name the supplying ancestors (not the item itself)", () => {
    const eff = computeEffectiveTags(ws());
    expect(inheritedFrom("file-deep", T_CLIENTS, eff)).toContain("contracts");
    expect(inheritedFrom("file-deep", "tag-direct", eff)).toEqual([]);
    expect(inheritedFrom("client-a", T_CLIENTS, eff)).toContain("clients");
  });

  it("cycles and missing parents terminate safely", () => {
    const input = ws();
    input.folderParent = { a: "b", b: "a", orphan: "ghost" };
    input.folderDirect = { a: ["t1"], b: [], orphan: [] };
    input.files = [{ id: "f", folder: "a", google_parent_id: null, drive_account_id: null }];
    const eff = computeEffectiveTags(input);
    expect(eff.files["f"]).toContain("t1");
    expect(workspaceAncestors("a", new Map(Object.entries(input.folderParent))).length).toBeLessThanOrEqual(200);
  });

  it("deep hierarchies stay linear (memoized, capped)", () => {
    const N = 500;
    const folderParent: Record<string, string | null> = { f0: null };
    for (let i = 1; i < N; i++) folderParent[`f${i}`] = `f${i - 1}`;
    const files = Array.from({ length: 2000 }, (_, i) => ({
      id: `file${i}`, folder: `f${N - 1}`, google_parent_id: null, drive_account_id: null,
    }));
    const t0 = Date.now();
    const eff = computeEffectiveTags({ fileDirect: {}, folderDirect: { f0: ["t"] }, folderParent, googleFolders: [], files });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(eff.files["file0"]).toContain("t");
  });
});

describe("google drive inheritance", () => {
  const g = () => ({
    fileDirect: {} as Record<string, string[]>,
    folderDirect: {} as Record<string, string[]>,
    folderParent: {} as Record<string, string | null>,
    googleFolders: [
      { id: "grow", google_id: "GROOT", parent: null, account: "A1" },
      { id: "grmid", google_id: "GMID", parent: "GROOT", account: "A1" },
    ],
    files: [
      { id: "gdeep", folder: null, google_parent_id: "GMID", drive_account_id: "A1" },
      { id: "gother", folder: null, google_parent_id: "GMID", drive_account_id: "A2" },
    ],
  });

  it("tagged google folders supply their whole same-account subtree", () => {
    const input = g();
    input.fileDirect = { grow: ["tag-g"] };
    const eff = computeEffectiveTags(input);
    expect(eff.files["gdeep"]).toContain("tag-g");
    expect(eff.files["grmid"]).toContain("tag-g");
  });

  it("chains never cross drive accounts", () => {
    const input = g();
    input.fileDirect = { grow: ["tag-g"] };
    const eff = computeEffectiveTags(input);
    expect(eff.files["gother"]).not.toContain("tag-g");
  });

  it("dual-homed rows union both ancestries", () => {
    const input = {
      fileDirect: { grow: ["tag-g"] } as Record<string, string[]>,
      folderDirect: { finance: [T_FINANCE] } as Record<string, string[]>,
      folderParent: { finance: null } as Record<string, string | null>,
      googleFolders: [
        { id: "grow", google_id: "GROOT", parent: null, account: "A1" },
        { id: "grmid", google_id: "GMID", parent: "GROOT", account: "A1" },
      ],
      files: [{ id: "dual", folder: "finance", google_parent_id: "GMID", drive_account_id: "A1" }],
    };
    const eff = computeEffectiveTags(input);
    expect(eff.files["dual"]).toEqual(expect.arrayContaining([T_FINANCE, "tag-g"]));
  });
});
