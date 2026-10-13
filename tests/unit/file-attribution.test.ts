import { describe, expect, it, vi, beforeEach } from "vitest";

// Attribution sources: audit modification events first, versions as fallback,
// Drive lastModifyingUser for external edits. Views/downloads never count;
// missing attribution is null ("Not recorded" upstream) — never invented.

const results: unknown[] = [];
function chain() {
  const final = results.length ? results.shift() : null;
  const c: Record<string, unknown> = {};
  c.select = () => c; c.eq = () => c; c.in = () => c; c.is = () => c;
  c.order = () => c; c.limit = () => c;
  c.maybeSingle = async () => ({ data: final });
  c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: final }).then(res);
  return c;
}

vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: () => chain() }),
}));

const driveState = { acct: null as null | { refresh_token: string }, meta: null as null | Record<string, unknown>, throws: false };
vi.mock("@/lib/drive-accounts", () => ({ getAccountFresh: async () => driveState.acct }));
vi.mock("@/lib/google-drive", () => ({
  driveClientFor: () => (driveState.acct ? {
    files: {
      get: async () => {
        if (driveState.throws) throw new Error("drive down");
        return { data: driveState.meta };
      },
    },
  } : null),
}));

import { latestFileAudit, latestVersionAttribution, latestFolderAttribution, googleAttribution, newest } from "@/lib/file-attribution";
import { adminClient } from "@/lib/supabase-admin";

const db = () => adminClient() as never;

describe("file attribution", () => {
  beforeEach(() => {
    results.length = 0;
    Object.assign(driveState, { acct: null, meta: null, throws: false });
  });

  it("audit modification events resolve actor + timestamp", async () => {
    results.push({ ts: "2026-10-01T10:00:00Z", actor_name: "amina" });
    expect(await latestFileAudit(db(), "f")).toEqual({ at: "2026-10-01T10:00:00Z", by: "amina" });
  });

  it("audit rows without an actor are not attribution", async () => {
    results.push({ ts: "2026-10-01T10:00:00Z", actor_name: null });
    expect(await latestFileAudit(db(), "f")).toBeNull();
  });

  it("versions fall back with the actor username", async () => {
    results.push({ ts: "2026-09-01T10:00:00Z", actor: "u1" });
    results.push({ username: "yusuf" });
    expect(await latestVersionAttribution(db(), "f")).toEqual({ at: "2026-09-01T10:00:00Z", by: "yusuf" });
  });

  it("versions without a resolvable actor are not attribution", async () => {
    results.push({ ts: "2026-09-01T10:00:00Z", actor: "gone" });
    results.push(null);
    expect(await latestVersionAttribution(db(), "f")).toBeNull();
  });

  it("folders take the newest of folder ops vs direct-child events", async () => {
    results.push([{ ts: "2026-10-02T10:00:00Z", actor_name: "amina" }]); // folder op
    results.push({ ts: "2026-10-05T10:00:00Z", actor_name: "yusuf" }); // child edit wins
    expect(await latestFolderAttribution(db(), "fid", "Design", ["c1"])).toEqual({ at: "2026-10-05T10:00:00Z", by: "yusuf" });
  });

  it("folders with no operations report null", async () => {
    results.push([]);
    results.push(null);
    expect(await latestFolderAttribution(db(), "fid", "Design", ["c1"])).toBeNull();
  });

  it("Drive lastModifyingUser resolves external editors", async () => {
    driveState.acct = { refresh_token: "r" };
    driveState.meta = { modifiedTime: "2026-10-06T10:00:00Z", lastModifyingUser: { displayName: "External Ada" } };
    expect(await googleAttribution("g1", "a1")).toEqual({ at: "2026-10-06T10:00:00Z", by: "External Ada" });
  });

  it("Drive failures and missing editors yield null (never invented)", async () => {
    driveState.acct = { refresh_token: "r" };
    driveState.meta = { modifiedTime: "2026-10-06T10:00:00Z", lastModifyingUser: {} };
    expect(await googleAttribution("g1", "a1")).toBeNull();
    driveState.throws = true;
    expect(await googleAttribution("g1", "a1")).toBeNull();
    expect(await googleAttribution("", "")).toBeNull();
  });

  it("newest() prefers the later event", async () => {
    const a = { at: "2026-10-01T00:00:00Z", by: "amina" };
    const b = { at: "2026-10-02T00:00:00Z", by: "yusuf" };
    expect(newest(a, b)).toBe(b);
    expect(newest(b, a)).toBe(b);
    expect(newest(null, a)).toBe(a);
    expect(newest(a, null)).toBe(a);
  });
});
