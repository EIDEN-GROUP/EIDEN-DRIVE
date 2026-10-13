import { beforeEach, describe, expect, it, vi } from "vitest";

// Admin-only boundary (task 1): managers and members get 403 + code
// "forbidden" on every restricted page API. Anomalous 500s or silent
// successes would mean the gate is missing or ordered wrong.

const state = { role: "manager" as "admin" | "manager" | "member" | null };

function table(name: string): any {
  const q: any = {
    select: () => q, eq: () => q, is: () => q, ilike: () => q, in: () => q,
    limit: () => q, order: () => q, range: () => q,
    head: () => q,
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res),
    maybeSingle: async () => ({ data: null }),
    single: async () => ({ data: null, error: { message: "no row" } }),
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "nope" } }) }) }),
    update: () => ({ eq: async () => ({ error: null }), in: async () => ({ error: null }) }),
    delete: () => ({ eq: async () => ({ error: null }), in: async () => ({ error: null }) }),
    upsert: async () => ({ error: null }),
  };
  void name;
  return q;
}

vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => (state.role ? { id: "u1", username: "boss", role: state.role, department_tag: null } : null) };
});
vi.mock("@/lib/audit", () => ({ logAudit: async () => {} }));
vi.mock("@/lib/supabase-admin", () => ({
  hasAdminClient: () => true,
  adminClient: () => ({ from: table }),
}));
vi.mock("@/lib/supabase-server", () => ({ createClient: () => ({ from: table }) }));

import { GET as activity } from "@/app/api/activity/route";
import { GET as storageJobs } from "@/app/api/storage/jobs/route";
import { PATCH as accountsPatch, DELETE as accountsDelete } from "@/app/api/drive/accounts/route";
import { POST as resyncClean } from "@/app/api/drive/resync-clean/route";
import { PATCH as settingsPatch } from "@/app/api/drive/settings/route";
import { GET as relinkGet, POST as relinkPost } from "@/app/api/drive/relink/route";
import { GET as slackGet } from "@/app/api/integrations/slack/route";
import { POST as storagePost } from "@/app/api/storage/route";

const get = (fn: (r: Request) => Promise<Response>) => fn(new Request("http://x/api"));
const post = (fn: (r: Request) => Promise<Response>, body: unknown) =>
  fn(new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const patch = (fn: (r: Request) => Promise<Response>, body: unknown) =>
  fn(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const del = (fn: (r: Request) => Promise<Response>, body: unknown) =>
  fn(new Request("http://x/api", { method: "DELETE", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

const UUID = "11111111-1111-4111-8111-111111111111";

describe("admin-only APIs", () => {
  beforeEach(() => { state.role = "manager"; });

  it("403s managers (and members) everywhere, with code forbidden", async () => {
    const calls: [string, () => Promise<Response>][] = [
      ["activity", () => get(activity)],
      ["storage-jobs", () => get(storageJobs)],
      ["accounts-patch", () => patch(accountsPatch, { id: UUID, label: "x" })],
      ["accounts-delete", () => del(accountsDelete, { id: UUID })],
      ["resync-clean", () => post(resyncClean, { accountId: UUID })],
      ["settings-patch", () => patch(settingsPatch, { value: true })],
      ["relink-get", () => get(relinkGet)],
      ["relink-post", () => post(relinkPost, { action: "delete", file_id: UUID })],
      ["slack-get", () => get(slackGet)],
      ["storage-post", () => post(storagePost, {})],
    ];
    for (const [name, fn] of calls) {
      const r = await fn();
      expect(r.status, name).toBe(403);
      expect(await r.json(), name).toMatchObject({ code: "forbidden" });
    }
    state.role = "member";
    for (const [name, fn] of calls) {
      expect((await fn()).status, name).toBe(403);
    }
  });

  it("admins pass the gates (endpoints run, DB-mock permitting)", async () => {
    state.role = "admin";
    // settings GET is the lightest admin read; others need fuller DB mocks.
    const { GET: settingsGet } = await import("@/app/api/drive/settings/route");
    const r = await settingsGet();
    expect(r.status).toBe(200);
  });
});
