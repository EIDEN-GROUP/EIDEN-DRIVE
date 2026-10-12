import { beforeEach, describe, expect, it, vi } from "vitest";

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const DISABLED = "22222222-2222-4222-8222-222222222222";
const MISSING = "33333333-3333-4333-8333-333333333333";

// drive_accounts rows keyed by id; status drives the gate.
const state = {
  accounts: {} as Record<string, { id: string; label: string; email: string | null; refresh_token: string; root_id: string | null; status: string; priority: number }>,
  role: "member" as "admin" | "manager" | "member" | null,
};
const ops: string[] = [];

function table(name: string): any {
  const q: any = {
    select: () => q, eq: () => q, not: () => q, is: () => q, range: () => q, order: () => q, limit: () => q, in: () => q,
    maybeSingle: async () => {
      if (name === "drive_accounts") {
        const id = (q as any)._eq;
        return { data: state.accounts[id] ?? null };
      }
      return { data: null };
    },
    insert: (row: unknown) => {
      ops.push(`insert:${name}`);
      return { select: () => ({ single: async () => ({ data: { id: "file-1" }, error: null }) }) };
    },
    update: () => ({ eq: async () => ({ error: null }) }),
  };
  // capture the eq id for drive_accounts lookups
  const origEq = q.eq;
  q.eq = (col: string, val: unknown) => { q._eq = val; return origEq(col, val); };
  return q;
}

vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => (state.role ? { id: "u1", username: "boss", role: state.role, department_tag: null } : null) };
});
vi.mock("@/lib/audit", () => ({ logAudit: async () => {} }));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({
    from: table,
    storage: { from: () => ({ remove: async (paths: string[]) => { ops.push(`storage:remove:${paths.join(",")}`); return { error: null }; } }) },
  }),
}));
vi.mock("@/lib/usb", () => ({ queueUsbUpload: async () => ({ jobId: "j1" }) }));
vi.mock("@/lib/upload-notify", () => ({ notifyUpload: async () => {} }));
vi.mock("@/lib/visibility", async () => {
  const real = await vi.importActual<typeof import("@/lib/visibility")>("@/lib/visibility");
  return { ...real, folderUsable: async () => ({ ok: true }), googleInScope: async () => true, bustScopeCache: () => {} };
});
vi.mock("@/lib/google-drive", () => ({ rootFor: async () => ({ kind: "mydrive", id: "root" }), googleErrorMessage: (m: string) => m }));
vi.mock("@/lib/storage", async () => {
  const real = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return { ...real, signedUploadUrl: async (path: string) => ({ signedUrl: "https://signed/x", path }) };
});

import { requireActiveAccount } from "@/lib/drive-accounts";
import { POST as register } from "@/app/api/drive/upload/route";
import { POST as init } from "@/app/api/drive/upload-url/route";

const row = (id: string, status: string) => ({ id, label: `D-${id.slice(0, 4)}`, email: null, refresh_token: "rt", root_id: null, status, priority: 0 });

describe("requireActiveAccount (fresh, uncached)", () => {
  beforeEach(() => {
    state.accounts = { [ACTIVE]: row(ACTIVE, "active"), [DISABLED]: row(DISABLED, "disabled") };
  });
  it("returns the account when active", async () => {
    const r = await requireActiveAccount(ACTIVE);
    expect("account" in r && r.account.id).toBe(ACTIVE);
  });
  it("404s unknown drives", async () => {
    const r = await requireActiveAccount(MISSING);
    expect(r).toMatchObject({ status: 404 });
  });
  it("410s disabled drives with an actionable message", async () => {
    const r = await requireActiveAccount(DISABLED);
    expect(r).toMatchObject({ status: 410 });
    expect((r as { error: string }).error).toMatch(/disabled/i);
  });
});

describe("upload register: pinned-drive availability", () => {
  beforeEach(() => {
    ops.length = 0;
    state.role = "member";
    state.accounts = { [ACTIVE]: row(ACTIVE, "active"), [DISABLED]: row(DISABLED, "disabled") };
  });
  const reg = (body: unknown) =>
    register(new Request("http://x/api/drive/upload", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
  const base = { name: "a.pdf", mime: "application/pdf", size: 10, hash: "a".repeat(64), storage_path: "u1/a.pdf" };

  it("rejects an explicitly pinned disabled drive BEFORE creating any row, and cleans staged bytes", async () => {
    const r = await reg({ ...base, drive_account: DISABLED });
    expect(r.status).toBe(410);
    expect(await r.json()).toMatchObject({});
    // Staged object removed, index row never created.
    expect(ops).toContain("storage:remove:u1/a.pdf");
    expect(ops).not.toContain("insert:file_index");
  });

  it("404s an explicitly pinned unknown drive", async () => {
    const r = await reg({ ...base, drive_account: MISSING });
    expect(r.status).toBe(404);
    expect(ops).not.toContain("insert:file_index");
  });

  it("local-only uploads (explicit null) skip the drive gate", async () => {
    const r = await reg({ ...base, drive_account: null });
    expect(r.status).toBe(200);
    expect(ops).toContain("insert:file_index");
  });
});

describe("upload-url init: drive pre-check", () => {
  beforeEach(() => {
    ops.length = 0;
    state.role = "member";
    state.accounts = { [ACTIVE]: row(ACTIVE, "active"), [DISABLED]: row(DISABLED, "disabled") };
  });
  const call = (body: unknown) =>
    init(new Request("http://x/api/drive/upload-url", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
  it("refuses a disabled pinned drive before minting", async () => {
    const r = await call({ name: "a.pdf", mime: "application/pdf", size: 10, drive_account: DISABLED });
    expect(r.status).toBe(410);
  });
  it("refuses drive pins alongside the pfp bucket", async () => {
    const r = await call({ name: "a.png", mime: "image/png", size: 10, bucket: "pfp", drive_account: ACTIVE });
    expect(r.status).toBe(400);
  });
  it("mints when the pinned drive is active (or unpinned)", async () => {
    expect((await call({ name: "a.pdf", mime: "application/pdf", size: 10, drive_account: ACTIVE })).status).toBe(200);
    expect((await call({ name: "b.pdf", mime: "application/pdf", size: 10 })).status).toBe(200);
  });
});
