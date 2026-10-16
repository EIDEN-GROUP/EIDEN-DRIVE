import { describe, expect, it, vi, beforeEach } from "vitest";

// POST /api/folders/slack-mute: target + selected descendants are validated
// as true accessible descendants (forged ids fail the whole request),
// writes are explicit rows only, and every change is audited.

const state = {
  me: { id: "m1", role: "member", username: "sam" },
  folders: {} as Record<string, { id: string; name: string } | null>,
  usable: true,
  writes: [] as { op: string; row: unknown }[],
  deletes: [] as { table: string; eq: [string, unknown][] }[],
  audits: 0,
};

function chain(table: string) {
  const q: Record<string, unknown> = {};
  const eqs: [string, unknown][] = [];
  q.select = () => q;
  q.eq = (c: string, v: unknown) => { eqs.push([c, v]); return q; };
  q.limit = () => q;
  q.upsert = async (row: unknown) => { state.writes.push({ op: "upsert", row }); return { error: null }; };
  q.delete = () => ({
    eq: (c: string, v: unknown) => {
      eqs.push([c, v]);
      state.deletes.push({ table, eq: [...eqs] });
      return Promise.resolve({ error: null });
    },
  });
  q.maybeSingle = async () => {
    if (table === "folders") return { data: state.folders[(eqs.find(([c]) => c === "id")?.[1] ?? "") as string] ?? null };
    return { data: null };
  };
  (q as { then: unknown }).then = (res: (v: unknown) => unknown) => {
    // workspaceDescendants list query
    if (table === "folders") {
      return Promise.resolve({
        data: [
          { id: "11111111-1111-4111-8111-111111111111", name: "root", parent: null },
          { id: "22222222-2222-4222-8222-222222222222", name: "child", parent: "11111111-1111-4111-8111-111111111111" },
          { id: "33333333-3333-4333-8333-333333333333", name: "grand", parent: "22222222-2222-4222-8222-222222222222" },
        ],
        error: null,
      }).then(res);
    }
    return Promise.resolve({ data: [], error: null }).then(res);
  };
  return q;
}

vi.mock("@/lib/roles", () => ({ getProfile: async () => state.me }));
vi.mock("@/lib/audit", () => ({ logAudit: async () => { state.audits++; } }));
vi.mock("@/lib/drive-accounts", () => ({ getAccounts: async () => [] }));
vi.mock("@/lib/visibility", async () => {
  const real = await vi.importActual<typeof import("@/lib/visibility")>("@/lib/visibility");
  return {
    ...real,
    folderUsable: async () => (state.usable ? { ok: true } : { ok: false, reason: "not allowed" }),
  };
});
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: (t: string) => chain(t) }),
}));
vi.mock("@/lib/folder-slack-mute", async () => {
  const real = await vi.importActual<typeof import("@/lib/folder-slack-mute")>("@/lib/folder-slack-mute");
  return { ...real };
});

import { POST, GET } from "@/app/api/folders/slack-mute/route";

const ROOT = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";
const GRAND = "33333333-3333-4333-8333-333333333333";

function post(body: unknown): Request {
  return new Request("http://x/api/folders/slack-mute", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("POST /api/folders/slack-mute", () => {
  beforeEach(() => {
    Object.assign(state, {
      usable: true, writes: [], deletes: [], audits: 0,
      folders: { [ROOT]: { id: ROOT, name: "root" } },
    });
  });

  it("mutes the target plus selected true descendants", async () => {
    const r = await POST(post({ target: { scope: "workspace", id: ROOT }, muted: true, also: [CHILD, GRAND] }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, muted: true });
    expect(state.writes).toHaveLength(3);
    expect(state.audits).toBe(1);
  });

  it("rejects forged descendant ids", async () => {
    const r = await POST(post({
      target: { scope: "workspace", id: ROOT }, muted: true, also: ["44444444-4444-4444-8444-444444444444"],
    }));
    expect(r.status).toBe(400);
    expect(state.writes).toHaveLength(0);
    expect(state.audits).toBe(0);
  });

  it("unusable folders stay 403 with no writes", async () => {
    state.usable = false;
    const r = await POST(post({ target: { scope: "workspace", id: ROOT }, muted: true, also: [] }));
    expect(r.status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });

  it("unmuting deletes rows", async () => {
    const r = await POST(post({ target: { scope: "workspace", id: ROOT }, muted: false, also: [] }));
    expect(r.status).toBe(200);
    expect(state.deletes.length).toBeGreaterThan(0);
  });

  it("GET returns target state plus the descendant tree", async () => {
    const r = await GET(new Request(`http://x/api/folders/slack-mute?scope=workspace&id=${ROOT}&tree=1`));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, label: "root", muted: false });
    expect(j.descendants.map((d: { id: string }) => d.id).sort()).toEqual([CHILD, GRAND]);
  });

  it("GET without tree=1 returns state only (cheap Details check)", async () => {
    const r = await GET(new Request(`http://x/api/folders/slack-mute?scope=workspace&id=${ROOT}`));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, label: "root", descendants: [] });
  });
});
