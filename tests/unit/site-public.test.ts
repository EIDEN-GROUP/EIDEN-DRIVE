import { describe, expect, it, vi, beforeEach } from "vitest";

// Public site surfaces (no browser session): the marketing homepage and the
// legal pages Google OAuth verification links to must pass middleware.

const state = { session: null as null | { user: { id: string } } };

vi.mock("@supabase/auth-helpers-nextjs", () => ({
  createMiddlewareClient: () => ({
    auth: { getSession: async () => ({ data: { session: state.session } }) },
  }),
}));

import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

describe("middleware public site pages", () => {
  beforeEach(() => {
    state.session = null;
  });

  it("lets unauthenticated visitors reach /, /privacy, and /terms", async () => {
    for (const p of ["/", "/privacy", "/terms"]) {
      const res = await middleware(new NextRequest(`http://prod.example${p}`));
      expect(res.status, p).toBe(200);
    }
  });

  it("still sends unauthenticated /drive visitors to login", async () => {
    const res = await middleware(new NextRequest("http://prod.example/drive"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/login\?next=%2Fdrive/);
  });
});
