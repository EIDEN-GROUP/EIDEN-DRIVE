import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase-server", () => ({
  createClient: () => ({ from: () => { throw new Error("no-db-in-unit"); } })
}));

import { can, needsApproval } from "../../lib/roles";

describe("can()", () => {
  it("members do everything except destructive/admin actions", () => {
    expect(can("member", "view")).toBe(true);
    expect(can("member", "perm-delete")).toBe(false);
    expect(can("member", "restore")).toBe(false);
    expect(can("member", "manage-users")).toBe(false);
    expect(can("member", "assign-tag")).toBe(false);
    expect(can("member", "create-vault")).toBe(false);
  });
  it("managers+ do admin actions, only admin changes roles (enforced in route)", () => {
    expect(can("manager", "restore")).toBe(true);
    expect(can("admin", "manage-users")).toBe(true);
  });
});

describe("needsApproval()", () => {
  it("always requires approval for permanent delete", () => {
    expect(needsApproval("Public", "perm-delete")).toBe(true);
  });
  it("requires approval deleting sensitive folders", () => {
    expect(needsApproval("Contracts", "delete")).toBe(true);
    expect(needsApproval("Public", "delete")).toBe(false);
  });
});
