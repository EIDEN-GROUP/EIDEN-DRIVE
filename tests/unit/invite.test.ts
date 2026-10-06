import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { me: null as null | { id: string; username: string; role: "admin" | "manager" | "member" } };
const invite = vi.fn();
const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));

vi.mock("@/lib/roles", async () => {
  const real = await vi.importActual<typeof import("@/lib/roles")>("@/lib/roles");
  return { ...real, getProfile: async () => state.me };
});
vi.mock("@/lib/audit", () => ({ logAudit: async () => {} }));
vi.mock("@/lib/supabase-server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase-admin", () => ({
  adminClient: () => ({
    auth: { admin: { inviteUserByEmail: invite } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "u1" } }) }) }), update, insert: async () => ({ error: null }) })
  })
}));

import { POST } from "@/app/api/users/invite/route";

const call = (body: unknown) => POST(new Request("http://localhost/api/users/invite", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe("POST /api/users/invite", () => {
  beforeEach(() => { invite.mockReset(); update.mockClear(); invite.mockResolvedValue({ data: { user: { id: "u1" } }, error: null }); });

  it("rejects anonymous and members", async () => {
    state.me = null;
    expect((await call({ email: "a@b.co" })).status).toBe(403);
    state.me = { id: "m", username: "m", role: "member" };
    expect((await call({ email: "a@b.co" })).status).toBe(403);
  });
  it("400 on a bad email (not a 500)", async () => {
    state.me = { id: "x", username: "x", role: "manager" };
    expect((await call({ email: "nope" })).status).toBe(400);
  });
  it("managers can invite members but not managers/admins", async () => {
    state.me = { id: "x", username: "x", role: "manager" };
    expect((await call({ email: "a@b.co", role: "member" })).status).toBe(201);
    expect((await call({ email: "a@b.co", role: "manager" })).status).toBe(403);
    expect((await call({ email: "a@b.co", role: "admin" })).status).toBe(403);
  });
  it("admins can invite any role; role + dept are applied by the server", async () => {
    state.me = { id: "a", username: "a", role: "admin" };
    const r = await call({ email: "New@Example.com ", role: "manager", department_tag: "Design" });
    expect(r.status).toBe(201);
    expect(invite).toHaveBeenCalledWith("new@example.com", expect.objectContaining({ redirectTo: expect.stringContaining("/welcome") }));
    expect(update).toHaveBeenCalledWith({ role: "manager", department_tag: "Design" });
  });
  it("409 when the email already has an account", async () => {
    state.me = { id: "a", username: "a", role: "admin" };
    invite.mockResolvedValue({ data: null, error: { message: "A user with this email address has already been registered" } });
    expect((await call({ email: "a@b.co" })).status).toBe(409);
  });
});
