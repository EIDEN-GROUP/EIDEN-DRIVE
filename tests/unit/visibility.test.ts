import { describe, expect, it } from "vitest";
import { accessContext, canTouch, fileOrClause, type Me } from "@/lib/visibility";

interface Fx {
  tags: { id: string; name: string }[];
  fileTags: { file_id: string; tag_id: string }[];
  folderTags: { folder_id: string; tag_id: string }[];
  folders: { id: string; dept: string | null; classification: string | null; parent: string | null }[];
}

// Minimal Supabase-shaped fake: only the chain surface visibility.ts uses.
function makeDb(fx: Fx) {
  const tagName = (id: string) => fx.tags.find((t) => t.id === id)?.name ?? "?";
  const applyEq = (rows: any[], filters: { col: string; val: any; ilike?: boolean }[]) =>
    rows.filter((r) =>
      filters.every((f) => {
        const v = r[f.col];
        if (f.ilike && typeof v === "string" && typeof f.val === "string") return v.toLowerCase() === f.val.toLowerCase();
        return v === f.val;
      })
    );
  return {
    from(table: string) {
      const filters: { col: string; val: any; ilike?: boolean }[] = [];
      let cols = "", head = false, lim = Infinity;
      const base = (): any[] => {
        if (table === "tags") return applyEq(fx.tags, filters);
        if (table === "file_tags") {
          const rows = applyEq(fx.fileTags, filters);
          if (cols.includes("tags!inner"))
            return rows.map((r) => ({ file_id: r.file_id, tag_id: r.tag_id, tags: { name: tagName(r.tag_id) } }));
          if (cols.includes("file_id") && !cols.includes("tag_id")) return rows.map((r) => ({ file_id: r.file_id }));
          return rows.map((r) => ({ file_id: r.file_id, tag_id: r.tag_id }));
        }
        if (table === "folder_tags") {
          return applyEq(fx.folderTags, filters).map((r) => ({ folder_id: r.folder_id, tag_id: r.tag_id }));
        }
        if (table === "folders") return applyEq(fx.folders, filters);
        return [];
      };
      const result = () => {
        const all = base();
        if (head) return { data: [], error: null, count: all.length };
        return { data: all.slice(0, lim), error: null };
      };
      const q: any = {
        select(c: string, o?: any) { cols = c; head = !!o?.head; return q; },
        eq(c: string, v: any) { filters.push({ col: c, val: v }); return q; },
        ilike(c: string, v: any) { filters.push({ col: c, val: v, ilike: true }); return q; },
        not() { return q; }, is() { return q; }, in() { return q; },
        order() { return q; }, limit(n: number) { lim = n; return q; }, range() { return q; },
        async maybeSingle() { const r = result(); return { data: (r.data as any[])[0] ?? null }; },
        async single() { const r = result(); return { data: (r.data as any[])[0] ?? null }; },
        then(res: any) { return Promise.resolve(result()).then(res); },
      };
      return q;
    },
  };
}

const member = (department_tag: string | null): Me => ({ id: "u1", role: "member", department_tag });
const F = (id: string, dept: string | null = null, parent: string | null = null) => ({ id, dept, classification: "Internal", parent });

describe("department-tag mode", () => {
  it("fallback: matching tag with zero assignments shows everything (not strict)", async () => {
    const db = makeDb({ tags: [{ id: "t1", name: "Design" }], fileTags: [], folderTags: [], folders: [F("f1")] });
    const ctx = await accessContext(db as any, member("Design"));
    expect(ctx.deptTagId).toBe("t1");
    expect(ctx.strict).toBe(false);
    // Commons leg survives in fallback.
    expect(fileOrClause(member("Design"), ctx.folders, ctx.taggedFiles, ctx.strict)).toContain("folder.is.null");
  });

  it("fallback: no matching tag at all shows everything", async () => {
    const db = makeDb({ tags: [{ id: "t9", name: "Legal" }], fileTags: [], folderTags: [], folders: [F("f1")] });
    const ctx = await accessContext(db as any, member("Design"));
    expect(ctx.deptTagId).toBeNull();
    expect(ctx.strict).toBe(false);
  });

  it("strict: assigned tag restricts to department content", async () => {
    const db = makeDb({
      tags: [{ id: "t1", name: "Design" }],
      fileTags: [{ file_id: "file1", tag_id: "t1" }],
      folderTags: [{ folder_id: "f1", tag_id: "t1" }],
      folders: [F("f1"), F("f2"), F("d1", "Design")],
    });
    const ctx = await accessContext(db as any, member("Design"));
    expect(ctx.strict).toBe(true);
    expect(ctx.taggedFiles.has("file1")).toBe(true);
    const clause = fileOrClause(member("Design"), ctx.folders, ctx.taggedFiles, ctx.strict);
    expect(clause).not.toContain("folder.is.null");
    expect(clause).toContain("id.in.(file1)");
    // Tagged folder + department-column folder show; commons folder hides.
    expect(ctx.folders!.has("f1")).toBe(true);
    expect(ctx.folders!.has("d1")).toBe(true);
    expect(ctx.folders!.has("f2")).toBe(false);
  });

  it("strict: tagged folder opens its whole subtree", async () => {
    const db = makeDb({
      tags: [{ id: "t1", name: "Design" }],
      fileTags: [],
      folderTags: [{ folder_id: "f1", tag_id: "t1" }],
      folders: [F("f1"), F("child", null, "f1"), F("grand", null, "child"), F("other")],
    });
    const ctx = await accessContext(db as any, member("Design"));
    expect(ctx.strict).toBe(true);
    expect(ctx.folders).not.toBeNull();
    expect(ctx.folders!.has("f1")).toBe(true);
    expect(ctx.folders!.has("child")).toBe(true);
    expect(ctx.folders!.has("grand")).toBe(true);
    expect(ctx.folders!.has("other")).toBe(false);
  });

  it("strict: folderless untagged file is denied unless owned or tagged", async () => {
    const db = makeDb({
      tags: [{ id: "t1", name: "Design" }],
      fileTags: [{ file_id: "file1", tag_id: "t1" }],
      folderTags: [],
      folders: [],
    });
    const me = member("Design");
    // Someone else's untagged commons file → hidden in strict mode.
    await expect(canTouch(db as any, me, { id: "plain", owner: "u2", folder: null }).then((r) => r.ok)).resolves.toBe(false);
    // Own file → always visible.
    await expect(canTouch(db as any, me, { id: "mine", owner: "u1", folder: null }).then((r) => r.ok)).resolves.toBe(true);
    // Directly tagged file → visible.
    await expect(canTouch(db as any, me, { id: "file1", owner: "u2", folder: null }).then((r) => r.ok)).resolves.toBe(true);
  });

  it("fallback: folderless untagged file stays visible (commons)", async () => {
    const db = makeDb({ tags: [{ id: "t1", name: "Design" }], fileTags: [], folderTags: [], folders: [] });
    await expect(
      canTouch(db as any, member("Design"), { id: "plain", owner: "u2", folder: null }).then((r) => r.ok)
    ).resolves.toBe(true);
  });

  it("file carrying only another department's tag is denied (both modes)", async () => {
    const mk = (assigned: boolean) =>
      makeDb({
        tags: [{ id: "t1", name: "Design" }, { id: "t2", name: "Legal" }],
        fileTags: assigned
          ? [{ file_id: "file1", tag_id: "t1" }, { file_id: "legal-doc", tag_id: "t2" }]
          : [{ file_id: "legal-doc", tag_id: "t2" }],
        folderTags: [],
        folders: [],
      });
    // Strict mode (Design tag assigned): legal-doc denied.
    await expect(
      canTouch(mk(true) as any, member("Design"), { id: "legal-doc", owner: "u2", folder: null }).then((r) => r.ok)
    ).resolves.toBe(false);
    // Fallback (Design tag unassigned): legal-doc still denied — it belongs to Legal.
    await expect(
      canTouch(mk(false) as any, member("Design"), { id: "legal-doc", owner: "u2", folder: null }).then((r) => r.ok)
    ).resolves.toBe(false);
  });
});
