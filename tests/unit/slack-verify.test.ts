import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "crypto";

// Real verification logic (no mocks): valid, tampered, missing, expired,
// wrong-secret, and missing-secret-config cases.

const SECRET = "test-signing-secret-1234567890";
const saved: Record<string, string | undefined> = {};

function sign(secret: string, ts: string, body: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
}
function reqOf(body: string, ts: string, sig: string): Request {
  return new Request("http://x/api/slack/commands", {
    method: "POST",
    headers: { "x-slack-request-timestamp": ts, "x-slack-signature": sig },
    body,
  });
}

import { verifySlackRequest } from "@/lib/slack";

beforeEach(() => {
  for (const k of ["SLACK_SIGNING_SECRET"] as const) {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env.SLACK_SIGNING_SECRET = SECRET;
  }
});

describe("verifySlackRequest", () => {
  const body = "token=x&team_id=T&user_id=U";

  it("accepts a valid signature", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await verifySlackRequest(reqOf(body, ts, sign(SECRET, ts, body)), body);
    expect(r).toEqual({ ok: true });
  });

  it("rejects tampered bodies and wrong signatures", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const good = sign(SECRET, ts, body);
    expect((await verifySlackRequest(reqOf(body, ts, good.slice(0, -1) + "0"), body)).ok).toBe(false);
    expect((await verifySlackRequest(reqOf(body + "&evil=1", ts, good), body + "&evil=1")).ok).toBe(false);
    expect((await verifySlackRequest(reqOf(body, ts, sign("other-secret", ts, body)), body)).ok).toBe(false);
  });

  it("rejects missing headers", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const noSig = new Request("http://x/", { method: "POST", headers: { "x-slack-request-timestamp": ts }, body });
    expect((await verifySlackRequest(noSig, body)).ok).toBe(false);
    const noTs = new Request("http://x/", { method: "POST", headers: { "x-slack-signature": "v0=abc" }, body });
    expect((await verifySlackRequest(noTs, body)).ok).toBe(false);
  });

  it("rejects expired timestamps (replay window)", async () => {
    const old = String(Math.floor(Date.now() / 1000) - 600);
    expect((await verifySlackRequest(reqOf(body, old, sign(SECRET, old, body)), body)).ok).toBe(false);
    const future = String(Math.floor(Date.now() / 1000) + 600);
    expect((await verifySlackRequest(reqOf(body, future, sign(SECRET, future, body)), future)).ok).toBe(false);
  });

  it("fails closed with no signing secret configured", async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const ts = String(Math.floor(Date.now() / 1000));
    expect((await verifySlackRequest(reqOf(body, ts, sign(SECRET, ts, body)), body)).ok).toBe(false);
    process.env.SLACK_SIGNING_SECRET = SECRET;
  });
});
