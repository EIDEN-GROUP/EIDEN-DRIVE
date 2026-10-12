import { beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the 0018 fallback paths: when file_index.created_at /
// folders.created_at+created_by don't exist yet (migration not applied),
// both listing routes retry with the old column shape instead of 500ing.
// Simulates the pre-migration schema by failing any select/insert that
// mentions the new columns.

const selects: string[] = [];
const inserts: { table: string; row: unknown }[] = [];

function fakeClient() {
  // Chainable enough for every query shape the two routes use:
  // select→order→limit, select→ilike→or→range, plain select→range.
  const finish = (table: string, cols: string) => {
    selects.push(`${table}:${cols}`);
    if (/created_(at|by)/.test(cols)) {
      const col = cols.match(/created_(at|by)/)![0];
      return { data: null, error: { message: `column "${col}" does not exist` } };
    }
    if (table === "folders") {
      return { data: [{ id: "f1", name: "A", parent: null, dept: null, classification: "Internal" }], error: null };
    }
    if (table === "file_index") {
      return {
        data: [{ id: "file-1", name: "a.pdf", mime: "application/pdf", size: 10, backends: ["local"], owner: "u1", updated_at: "2026-01-01", folder: null, hash: null, storage_path: "u1/a.pdf", google_file_id: null, drive_account_id: null, google_parent_id: null }],
        error: null,
      };
    }
    return { data: [], error: null };
  };
  const chain = (table: string, cols: string): any => {
    const q: any = {
      order: () => ({ limit: async () => finish(table, cols) }),
      ilike: () => ({ or: () => ({ range: async () => finish(table, cols) }), range: async () => finish(table, cols) }),
      limit: async () => finish(table, cols),
      range: async () => finish(table, cols),
      in: async () => ({ data: [], error: null }),
    };
    return q;
  };
  return {
    from: (table: string) => ({
      select: (cols: string) => chain(table, cols),
      insert: (row: unknown) => {
        inserts.push({ table, row });
        return {
          select: () => ({
            single: async () => {
              if (row && typeof row === "object" && "created_by" in (row as Record<string, unknown>)) {
                return { data: null, error: { message: 'column "created_by" of relation "folders" does not exist' } };
              }
              return { data: { id: "new-1" }, error: null };
            },
          }),
        };
      },
    }),
  };
}

vi.mock("@/lib/supabase-server", () => ({ createClient: () => fakeClient() }));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => fakeClient(),
}));
vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => ({ id: "u1", username: "boss", role: "admin", department_tag: null }) };
});
vi.mock("@/lib/audit", () => ({ logAudit: async () => {} }));
vi.mock("@/lib/drive-accounts", async () => {
  const real = await vi.importActual<typeof import("@/lib/drive-accounts")>("@/lib/drive-accounts");
  return { ...real, getAccounts: async () => [] };
});

import { GET as foldersGet, POST as foldersPost } from "@/app/api/folders/route";
import { GET as driveGet } from "@/app/api/drive/route";

describe("0018 fallback (pre-migration schema)", () => {
  beforeEach(() => {
    selects.length = 0;
    inserts.length = 0;
  });

  it("folders GET retries without created_at/created_by and still returns rows", async () => {
    const r = await foldersGet();
    expect(r.status).toBe(200);
    expect(selects[0]).toContain("created_at");
    expect(selects[1]).not.toContain("created_at");
    const body = (await r.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(1);
  });

  it("folders POST inserts without created_by when the column is missing", async () => {
    const r = await foldersPost(
      new Request("http://x/api/folders", { method: "POST", body: JSON.stringify({ name: "N" }), headers: { "content-type": "application/json" } })
    );
    expect(r.status).toBe(201);
    expect(inserts).toHaveLength(2);
    expect(inserts[0].row).toMatchObject({ created_by: "u1" });
    expect(inserts[1].row).not.toHaveProperty("created_by");
  });

  it("drive GET retries the page without created_at and still returns rows", async () => {
    const r = await driveGet(new Request("http://x/api/drive?q=&limit=50&offset=0"));
    expect(r.status).toBe(200);
    const withCol = selects.filter((s) => s.includes("created_at"));
    const withoutCol = selects.filter((s) => s.startsWith("file_index:") && !s.includes("created_at"));
    expect(withCol.length).toBeGreaterThanOrEqual(1);
    expect(withoutCol.length).toBeGreaterThanOrEqual(1);
    const body = (await r.json()) as { results: unknown[] };
    expect(body.results.length).toBeGreaterThanOrEqual(1);
  });
});
