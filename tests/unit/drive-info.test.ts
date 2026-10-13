import { describe, expect, it, vi, beforeEach } from "vitest";

// GET /api/drive/info — access is rechecked server-side before any audit
// metadata is returned; missing and forbidden both read 404 (no oracle).
// modified_at + modified_by always describe the same event; nulls mean the
// documented "Not recorded" fallback. Views/downloads never surface here
// (attribution sources only admit modification actions).

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

const state = { me: null as null | { id: string; role: string }, touchOk: true, folders: null as null | Set<string> };

vi.mock("@/lib/roles", () => ({ getProfile: async () => state.me }));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: () => chain() }),
}));
vi.mock("@/lib/visibility", async () => {
  const real = await vi.importActual<typeof import("@/lib/visibility")>("@/lib/visibility");
  return { ...real, canTouch: async () => (state.touchOk ? { ok: true } : { ok: false, reason: "denied" }), accessContext: async () => ({ folders: state.folders }) };
});
vi.mock("@/lib/drive-accounts", () => ({ getAccountFresh: async () => null }));

import { GET } from "@/app/api/drive/info/route";

const FILE = { id: "11111111-1111-4111-8111-111111111111", owner: "o", folder: null, google_file_id: null, drive_account_id: null };

describe("GET /api/drive/info", () => {
  beforeEach(() => {
    results.length = 0;
    Object.assign(state, { me: { id: "m", role: "member" }, touchOk: true, folders: null });
  });

  it("requires a session", async () => {
    state.me = null;
    const r = await GET(new Request(`http://x/api/drive/info?file_id=${FILE.id}`));
    expect(r.status).toBe(401);
  });

  it("requires an id", async () => {
    expect((await GET(new Request("http://x/api/drive/info"))).status).toBe(400);
  });

  it("returns the recorded editor with its own timestamp", async () => {
    results.push(FILE);
    results.push({ ts: "2026-10-03T12:00:00Z", actor_name: "amina" });
    const r = await GET(new Request(`http://x/api/drive/info?file_id=${FILE.id}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, modified_at: "2026-10-03T12:00:00Z", modified_by: "amina" });
  });

  it("falls back to versions, then to nulls (documented fallback)", async () => {
    results.push(FILE, null, { ts: "2026-09-01T00:00:00Z", actor: "u1" }, { username: "yusuf" });
    const r = await GET(new Request(`http://x/api/drive/info?file_id=${FILE.id}`));
    expect(await r.json()).toMatchObject({ modified_by: "yusuf" });
    results.push(FILE, null, null);
    const r2 = await GET(new Request(`http://x/api/drive/info?file_id=${FILE.id}`));
    expect(await r2.json()).toMatchObject({ modified_at: null, modified_by: null });
  });

  it("denied files read 404 (no existence oracle)", async () => {
    results.push(FILE);
    state.touchOk = false;
    const r = await GET(new Request(`http://x/api/drive/info?file_id=${FILE.id}`));
    expect(r.status).toBe(404);
    expect(JSON.stringify(await r.json())).not.toMatch(/denied/);
  });

  it("folders resolve through folder ops with access recheck", async () => {
    results.push({ id: "22222222-2222-4222-8222-222222222222", name: "Design" });
    results.push([{ id: "c1" }]);
    results.push([{ ts: "2026-10-04T00:00:00Z", actor_name: "amina" }]);
    results.push(null);
    const r = await GET(new Request("http://x/api/drive/info?folder_id=22222222-2222-4222-8222-222222222222"));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ modified_by: "amina" });
  });

  it("folders outside the member scope read 404", async () => {
    results.push({ id: "22222222-2222-4222-8222-222222222222", name: "Design" });
    state.folders = new Set(["other"]);
    expect((await GET(new Request("http://x/api/drive/info?folder_id=22222222-2222-4222-8222-222222222222"))).status).toBe(404);
  });
});
