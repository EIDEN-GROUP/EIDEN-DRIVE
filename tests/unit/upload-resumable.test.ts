import { beforeEach, describe, expect, it, vi } from "vitest";

// Proof-by-construction: if either resumable route (or anything they touch,
// except the narrowly-mocked drive-accounts/visibility below) imports
// @/lib/storage, this factory throws at collect time and every test fails.
vi.mock("@/lib/storage", () => {
  throw new Error("@/lib/storage must never load on resumable upload paths");
});

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const DISABLED = "22222222-2222-4222-8222-222222222222";
const MISSING = "33333333-3333-4333-8333-333333333333";
const GFOLDER = "gfold3r000000000000000001";
const GFILE = "gfile00000000000000000001";

const state = {
  accounts: {} as Record<string, { id: string; label: string; email: string | null; refresh_token: string; root_id: string | null; status: string; priority: number }>,
  role: "member" as "admin" | "manager" | "member" | null,
  folderOk: true,
  scopeOk: true,
  rootKind: { kind: "folder", id: "scope-root" } as { kind: string; id: string },
  landed: null as null | { id?: string; name?: string; mimeType?: string; size?: string; parents?: string[] },
  getThrows: false,
  insertThrows: false,
  sessionUri: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test",
  lastInsert: null as null | Record<string, unknown>,
};
const ops: string[] = [];

function table(name: string): any {
  const q: any = {
    select: () => q, eq: () => q, not: () => q, is: () => q, range: () => q, order: () => q, limit: () => q, in: () => q,
    maybeSingle: async () => {
      if (name === "drive_accounts") return { data: state.accounts[(q as any)._eq] ?? null };
      return { data: null };
    },
    insert: (row: unknown) => {
      ops.push(`insert:${name}`);
      if (name === "file_index") state.lastInsert = row as Record<string, unknown>;
      if (name === "file_index" && state.insertThrows) {
        return { select: () => ({ single: async () => ({ data: null, error: { message: "db down" } }) }) };
      }
      return { select: () => ({ single: async () => ({ data: { id: "file-1" }, error: null }) }) };
    },
    update: () => ({ eq: async () => ({ error: null }) }),
  };
  const origEq = q.eq;
  q.eq = (col: string, val: unknown) => { q._eq = val; return origEq(col, val); };
  return q;
}

vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => (state.role ? { id: "u1", username: "boss", role: state.role, department_tag: null } : null) };
});
vi.mock("@/lib/audit", () => ({ logAudit: async () => { ops.push("audit"); } }));
vi.mock("@/lib/upload-notify", () => ({ notifyUpload: async () => { ops.push("notify"); } }));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({
    from: table,
    // Any Storage access throws: the resumable path must never reach Storage.
    storage: { from: () => { throw new Error("Supabase Storage touched on a resumable path"); } },
  }),
}));
vi.mock("@/lib/rate", () => ({ rateLimited: () => false, clientIp: () => "test" }));
vi.mock("@/lib/visibility", async () => {
  const real = await vi.importActual<typeof import("@/lib/visibility")>("@/lib/visibility");
  return {
    ...real,
    folderUsable: async () => (state.folderOk ? { ok: true } : { ok: false, reason: "outside your department" }),
    googleInScope: async () => state.scopeOk,
    bustScopeCache: () => { ops.push("bust"); },
  };
});
vi.mock("@/lib/google-drive", () => ({
  rootFor: async () => state.rootKind,
  deleteDriveFile: async () => { ops.push("drive:delete"); return {}; },
  googleErrorMessage: (m: string) => m,
}));
vi.mock("@/lib/drive-accounts", async () => {
  const real = await vi.importActual<typeof import("@/lib/drive-accounts")>("@/lib/drive-accounts");
  return {
    ...real,
    getAccounts: async () => Object.values(state.accounts),
    pickUploadAccount: async (_size: number, preferId?: string | null) => {
      if (preferId) {
        const a = state.accounts[preferId];
        if (!a || a.status !== "active") return { account: null, reason: "chosen drive not found" };
        return { account: a };
      }
      const live = Object.values(state.accounts).filter((a) => a.status === "active");
      return live.length ? { account: live[0] } : { account: null, reason: "no Google accounts connected" };
    },
    accountAccessToken: async () => "test-token",
    clientFor: () => ({
      files: {
        get: async () => {
          if (state.getThrows) throw new Error("not found");
          return { data: state.landed };
        },
      },
    }),
  };
});
vi.mock("@/lib/resumable", async () => {
  const real = await vi.importActual<typeof import("@/lib/resumable")>("@/lib/resumable");
  return real;
});

// The init route reaches the network only through initiateResumableSession:
// stub HTTP at the boundary so tests exercise the real helper + real route.
const realFetch = globalThis.fetch;
beforeEach(() => {
  (globalThis as any).fetch = async () => new Response("", { status: 200, headers: { location: state.sessionUri } });
});
import { RESUMABLE_MAX, initiateResumableSession } from "@/lib/resumable";
import { POST as initSession } from "@/app/api/drive/resumable/init/route";
import { POST as completeUpload } from "@/app/api/drive/resumable/complete/route";

const row = (id: string, status: string, root_id: string | null = "scope-root") => ({
  id, label: `D-${id.slice(0, 4)}`, email: null, refresh_token: "rt", root_id, status, priority: 0,
});
const post = (fn: (r: Request) => Promise<Response>, body: unknown) =>
  fn(new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const landedOk = () => {
  state.landed = { id: GFILE, name: "big.mp4", mimeType: "video/mp4", size: "1048576", parents: ["scope-root"] };
};

describe("resumable init", () => {
  beforeEach(() => {
    ops.length = 0;
    Object.assign(state, {
      role: "member", folderOk: true, scopeOk: true, getThrows: false, insertThrows: false, lastInsert: null,
      rootKind: { kind: "folder", id: "scope-root" },
      accounts: { [ACTIVE]: row(ACTIVE, "active"), [DISABLED]: row(DISABLED, "disabled") },
    });
  });
  const initBody = { name: "big.mp4", mime: "video/mp4", size: 1048576, drive_account: ACTIVE };

  it("401s unauthenticated callers", async () => {
    state.role = null;
    expect((await post(initSession, initBody)).status).toBe(401);
  });
  it("400s over the 2 GB application cap", async () => {
    const r = await post(initSession, { ...initBody, size: RESUMABLE_MAX + 1 });
    expect(r.status).toBe(400);
  });
  it("404s unknown pinned drives", async () => {
    expect((await post(initSession, { ...initBody, drive_account: MISSING })).status).toBe(404);
  });
  it("410s disabled pinned drives with an actionable message", async () => {
    const r = await post(initSession, { ...initBody, drive_account: DISABLED });
    expect(r.status).toBe(410);
    expect(((await r.json()) as { error: string }).error).toMatch(/disabled/i);
  });
  it("400s when no drive is pinned or picked", async () => {
    const r = await post(initSession, { name: "a.mp4", size: 10, drive_account: null });
    expect(r.status).toBe(400);
  });
  it("403s out-of-department folders", async () => {
    state.folderOk = false;
    const r = await post(initSession, { ...initBody, folder: "44444444-4444-4444-8444-444444444444" });
    expect(r.status).toBe(403);
  });
  it("403s out-of-scope parents", async () => {
    state.scopeOk = false;
    const r = await post(initSession, { ...initBody, google_parent: GFOLDER });
    expect(r.status).toBe(403);
  });
  it("502s when no active drive can take the file", async () => {
    state.accounts = { [DISABLED]: row(DISABLED, "disabled") };
    const r = await post(initSession, { name: "a.mp4", size: 10 });
    expect(r.status).toBe(502);
  });
  it("mints a bound session on the happy path", async () => {
    const r = await post(initSession, initBody);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, sessionUri: state.sessionUri, accountId: ACTIVE, parentUsed: "scope-root", size: 1048576 });
  });
  it("auto-routes when unpinned", async () => {
    const r = await post(initSession, { name: "a.mp4", size: 10 });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { accountId: string }).accountId).toBe(ACTIVE);
  });
});

describe("resumable complete", () => {
  beforeEach(() => {
    ops.length = 0;
    Object.assign(state, {
      role: "member", folderOk: true, scopeOk: true, getThrows: false, insertThrows: false, lastInsert: null,
      rootKind: { kind: "folder", id: "scope-root" },
      accounts: { [ACTIVE]: row(ACTIVE, "active"), [DISABLED]: row(DISABLED, "disabled") },
    });
    landedOk();
  });
  const doneBody = { driveFileId: GFILE, accountId: ACTIVE, hash: "b".repeat(64) };

  it("400s when the file isn't in Drive (nothing to delete)", async () => {
    state.getThrows = true;
    const r = await post(completeUpload, doneBody);
    expect(r.status).toBe(400);
    expect(ops).not.toContain("drive:delete");
    expect(ops).not.toContain("insert:file_index");
  });
  it("410s drives disabled mid-upload", async () => {
    state.accounts[ACTIVE].status = "disabled";
    expect((await post(completeUpload, doneBody)).status).toBe(410);
    expect(ops).not.toContain("insert:file_index");
  });
  it("400s + removes bogus sizes", async () => {
    state.landed = { id: GFILE, name: "big.mp4", mimeType: "video/mp4", size: "0", parents: ["scope-root"] };
    expect((await post(completeUpload, doneBody)).status).toBe(400);
    expect(ops).toContain("drive:delete");
  });
  it("403s + removes out-of-scope landings", async () => {
    state.scopeOk = false;
    expect((await post(completeUpload, doneBody)).status).toBe(403);
    expect(ops).toContain("drive:delete");
  });
  it("400s + removes wrong-folder landings", async () => {
    state.landed = { ...(state.landed as object), parents: ["elsewhere00000000000001"] } as typeof state.landed;
    expect((await post(completeUpload, doneBody)).status).toBe(400);
    expect(ops).toContain("drive:delete");
  });
  it("403s + removes when the folder grant vanished mid-upload", async () => {
    state.folderOk = false;
    const r = await post(completeUpload, { ...doneBody, folder: "44444444-4444-4444-8444-444444444444" });
    expect(r.status).toBe(403);
    expect(ops).toContain("drive:delete");
  });
  it("indexes Google's record (not the client's word) on success", async () => {
    const r = await post(completeUpload, doneBody);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, id: "file-1" });
    expect(state.lastInsert).toMatchObject({
      name: "big.mp4", mime: "video/mp4", size: 1048576,
      backends: ["google"], storage_path: null,
      google_file_id: GFILE, google_parent_id: "scope-root", drive_account_id: ACTIVE,
    });
    expect(ops).toContain("insert:versions");
    expect(ops).toContain("audit");
    expect(ops).toContain("notify");
    expect(ops).toContain("bust");
    expect(ops).not.toContain("drive:delete");
  });
  it("500s + removes the stray when indexing fails", async () => {
    state.insertThrows = true;
    expect((await post(completeUpload, doneBody)).status).toBe(500);
    expect(ops).toContain("drive:delete");
  });
});

describe("initiateResumableSession (real helper, stubbed HTTP)", () => {
  // NOTE: global fetch is stubbed file-wide (see top); these cases swap it.
  it("returns the Location session URI", async () => {
    (globalThis as any).fetch = async () => new Response("", { status: 200, headers: { location: "https://upload/session/1" } });
    try {
      await expect(initiateResumableSession("tok", { name: "a", mime: "b", size: 1 })).resolves.toBe("https://upload/session/1");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  it("throws without a session URI or on HTTP errors", async () => {
    (globalThis as any).fetch = async () => new Response("", { status: 200 });
    try {
      await expect(initiateResumableSession("tok", { name: "a", mime: "b", size: 1 })).rejects.toThrow(/session/i);
    } finally {
      globalThis.fetch = realFetch;
    }
    (globalThis as any).fetch = async () => new Response("nope", { status: 403 });
    try {
      await expect(initiateResumableSession("tok", { name: "a", mime: "b", size: 1 })).rejects.toThrow(/403/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
