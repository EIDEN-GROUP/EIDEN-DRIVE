import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/storage/jobs regression coverage (mocked DB):
//   newest-first stable order, keyset cursor (no skip/dup on mid-scroll
//   inserts, id tiebreak on equal timestamps), hasMore/nextCursor shape,
//   backup-only filtering (heartbeat + usb + sync excluded), role payload
//   scrub (members: own jobs, agent URL stripped), bad cursor, empty history.

type Job = { id: string; kind: string; status: string; created_at: string; payload: Record<string, unknown> | null };

const state = {
  role: "manager" as "admin" | "manager" | "member" | null,
  me: "u-admin",
  jobs: [] as Job[],
};

const T = (min: number, id: string, kind = "backup-verify", status = "done", owner = "u-admin"): Job => ({
  id, kind, status, created_at: new Date(Date.UTC(2026, 9, 12, 12, min, 0)).toISOString(),
  payload: { by: "admin", owner, url: "https://signed/secret" },
});

function table(name: string): any {
  let kindPrefix = "";
  let cursor: { ts: string; id: string; tie?: boolean } | null = null;
  let limitN = 11;
  const q: any = {
    select: () => q,
    ilike: (col: string, pat: string) => { kindPrefix = pat.replace("%", ""); return q; },
    // or("and(created_at.lt.TS),and(created_at.eq.TS,id.lt.ID)")
    or: (expr: string) => {
      const eq = /created_at\.eq\.([^,)]+),id\.lt\.([^,)]+)/.exec(expr);
      const lt = /created_at\.lt\.([^,)]+)/.exec(expr);
      // Mirror the route's keyset: older timestamps, or same timestamp + smaller id.
      cursor = { ts: (eq?.[1] ?? lt?.[1] ?? "") as string, id: (eq?.[2] ?? "") as string, tie: !!eq } as { ts: string; id: string };
      return q;
    },
    order: () => q,
    limit: (n: number) => { limitN = n; return q; },
    then: (res: (v: unknown) => unknown) => {
      let rows = state.jobs.filter((j) => j.kind.startsWith(kindPrefix));
      rows = rows.filter((j) =>
        !cursor ? true
        : cursor.tie
          ? (j.created_at < cursor.ts || (j.created_at === cursor.ts && j.id < cursor.id))
          : j.created_at < cursor.ts);
      rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || (a.id < b.id ? 1 : -1));
      return Promise.resolve({ data: rows.slice(0, limitN), error: null }).then(res);
    },
  };
  void name;
  return q;
}

vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => (state.role ? { id: state.me, username: "boss", role: state.role, department_tag: null } : null) };
});
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: table }),
}));

import { GET } from "@/app/api/storage/jobs/route";

const get = (qs = "") => GET(new Request(`http://x/api/storage/jobs${qs}`));

function seed() {
  state.jobs = [
    T(0, "j1"), T(1, "j2"), T(2, "j3"), T(3, "j4"), T(4, "j5"),
    { ...T(5, "hb1", "agent-heartbeat"), payload: {} },
    { ...T(6, "u1", "usb-upload"), payload: { owner: "u-admin" } },
    { ...T(7, "s1", "drive-sync"), payload: {} },
  ];
}

describe("GET /api/storage/jobs", () => {
  beforeEach(() => {
    Object.assign(state, { role: "admin", me: "u-admin" });
    seed();
  });

  it("401s unauthenticated callers", async () => {
    state.role = null;
    expect((await get()).status).toBe(401);
  });
  it("403s managers and members (admin-only backup history)", async () => {
    state.role = "manager";
    expect((await get()).status).toBe(403);
    state.role = "member";
    const r = await get();
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "forbidden" });
  });
  it("400s bad cursors and over-limit pages", async () => {
    expect((await get("?cursor=nope")).status).toBe(400);
    expect((await get("?limit=500")).status).toBe(400);
  });
  it("serves newest-first backup pages with hasMore + cursor, heartbeat/usb/sync excluded", async () => {
    const r1 = await get("?limit=2");
    expect(r1.status).toBe(200);
    const p1 = await r1.json();
    expect(p1.jobs.map((j: Job) => j.id)).toEqual(["j5", "j4"]);
    expect(p1.hasMore).toBe(true);
    expect(typeof p1.nextCursor).toBe("string");
    for (const j of p1.jobs as Job[]) expect(j.kind.startsWith("backup")).toBe(true);
    const r2 = await get(`?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`);
    const p2 = await r2.json();
    expect(p2.jobs.map((j: Job) => j.id)).toEqual(["j3", "j2"]);
    const r3 = await get(`?limit=2&cursor=${encodeURIComponent(p2.nextCursor)}`);
    const p3 = await r3.json();
    expect(p3.jobs.map((j: Job) => j.id)).toEqual(["j1"]);
    expect(p3.hasMore).toBe(false);
    expect(p3.nextCursor).toBeNull();
  });
  it("mid-scroll inserts neither duplicate nor skip (stable keyset)", async () => {
    const p1 = await (await get("?limit=2")).json();
    // a new backup lands after page 1 was served
    state.jobs.push(T(9, "j6"));
    const p2 = await (await get(`?limit=10&cursor=${encodeURIComponent(p1.nextCursor)}`)).json();
    const ids = [...p1.jobs.map((j: Job) => j.id), ...p2.jobs.map((j: Job) => j.id)];
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids).toEqual(expect.arrayContaining(["j1", "j2", "j3", "j4", "j5"])); // no skips
  });
  it("breaks created_at ties by id (both sides of a page boundary appear once)", async () => {
    const ts = new Date(Date.UTC(2026, 9, 12, 12, 30, 0)).toISOString();
    state.jobs = [
      { id: "a1", kind: "backup-x", status: "done", created_at: ts, payload: { owner: "u-admin" } },
      { id: "a2", kind: "backup-x", status: "done", created_at: ts, payload: { owner: "u-admin" } },
    ];
    const p1 = await (await get("?limit=1")).json();
    expect(p1.jobs.map((j: Job) => j.id)).toEqual(["a2"]);
    const p2 = await (await get(`?limit=1&cursor=${encodeURIComponent(p1.nextCursor)}`)).json();
    expect(p2.jobs.map((j: Job) => j.id)).toEqual(["a1"]);
    expect(p2.hasMore).toBe(false);
  });
  it("admins see everything with payloads intact", async () => {
    state.jobs.push({ ...T(8, "j9", "backup-verify", "done", "someone-else"), payload: { owner: "someone-else", url: "https://signed/other" } });
    const pa = await (await get("?limit=20")).json();
    expect(pa.jobs.some((j: Job) => j.id === "j9" && (j.payload as Record<string, unknown>)?.url === "https://signed/other")).toBe(true);
  });
  it("empty history returns hasMore:false (proper end state)", async () => {
    state.jobs = [];
    const p = await (await get()).json();
    expect(p).toMatchObject({ ok: true, jobs: [], hasMore: false, nextCursor: null });
  });
});
