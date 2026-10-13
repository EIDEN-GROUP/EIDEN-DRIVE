import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

// Middleware allowlist for Slack callbacks (real middleware, mocked session
// layer): the three signature-verified callbacks pass WITHOUT a browser
// session; /api/slack/connect and everything else stay protected. A signed
// url_verification then flows through middleware into the real handler and
// echoes the challenge — proving the production path is reachable.

const state = { session: null as null | { user: { id: string } } };

vi.mock("@supabase/auth-helpers-nextjs", () => ({
  createMiddlewareClient: () => ({
    auth: { getSession: async () => ({ data: { session: state.session } }) },
  }),
}));

import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

const SECRET = "middleware-test-secret-0123456789abcdef";

async function through(path: string): Promise<{ status: number; location: string | null }> {
  const req = new NextRequest(`http://prod.example${path}`, { method: "POST" });
  const res = await middleware(req);
  return { status: res.status, location: res.headers.get("location") };
}

function signedChallenge(challenge: string): NextRequest {
  const raw = JSON.stringify({ type: "url_verification", challenge });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac("sha256", SECRET).update(`v0:${ts}:${raw}`).digest("hex")}`;
  return new NextRequest("http://prod.example/api/slack/events", {
    method: "POST",
    headers: { "x-slack-request-timestamp": ts, "x-slack-signature": sig },
    body: raw,
  });
}

describe("middleware Slack callback allowlist", () => {
  beforeEach(() => {
    state.session = null;
    process.env.SLACK_SIGNING_SECRET = SECRET;
  });

  it("lets the three signature-verified callbacks through with no session", async () => {
    for (const p of ["/api/slack/events", "/api/slack/commands", "/api/slack/interactions"]) {
      const r = await through(p);
      expect(r.status, p).toBe(200);
    }
  });

  it("keeps /api/slack/connect session-protected (401, no session)", async () => {
    expect((await through("/api/slack/connect")).status).toBe(401);
  });

  it("does not open /api/slack wholesale (bare path + unknown children stay 401)", async () => {
    expect((await through("/api/slack")).status).toBe(401);
    expect((await through("/api/slack/other")).status).toBe(401);
  });

  it("still guards unrelated APIs and redirects pages to login", async () => {
    expect((await through("/api/drive/files")).status).toBe(401);
    const page = await middleware(new NextRequest("http://prod.example/drive"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toMatch(/\/login\?next=%2Fdrive/);
  });

  it("passes everything through once a session exists", async () => {
    state.session = { user: { id: "u" } };
    for (const p of ["/api/slack/events", "/api/slack/connect", "/api/drive/files"]) {
      expect((await through(p)).status, p).toBe(200);
    }
  });

  it("a sessionless url_verification reaches the handler and echoes the challenge", async () => {
    const { POST } = await import("@/app/api/slack/events/route");
    const req = signedChallenge("challenge-echo-123");
    const gate = await middleware(req);
    expect(gate.status).toBe(200);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ challenge: "challenge-echo-123" });
  });

  it("tampered challenge bodies are rejected after passing the gate", async () => {
    const { POST } = await import("@/app/api/slack/events/route");
    const req = signedChallenge("real-challenge");
    expect((await middleware(req)).status).toBe(200);
    // Re-sign nothing: send a forged body under the original signature.
    const forged = new NextRequest("http://prod.example/api/slack/events", {
      method: "POST",
      headers: { "x-slack-request-timestamp": req.headers.get("x-slack-request-timestamp")!, "x-slack-signature": "v0=deadbeef" },
      body: JSON.stringify({ type: "url_verification", challenge: "forged" }),
    });
    expect((await POST(forged)).status).toBe(401);
  });
});
