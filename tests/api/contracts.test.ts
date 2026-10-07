import { beforeAll, describe, expect, it } from "vitest";

// Live HTTP suite — needs a running server:
//   local:  npm run dev  +  EIDEN_BASE_URL=http://localhost:3000  npm run test:live
//   prod:   EIDEN_BASE_URL=https://drive.eiden-group.com  npm run test:live
const BASE = process.env.EIDEN_BASE_URL ?? "http://localhost:3000";

async function get(path: string, follow = true) {
  return fetch(`${BASE}${path}`, { redirect: follow ? "follow" : "manual" });
}

describe("API contracts (anonymous)", () => {
  it("rejects drive listing without session", async () => {
    const r = await get("/api/drive?q=");
    expect([401, 307]).toContain(r.status);
  });
  it("rejects trash/restore/upload/rename/sync/folders/vault/users/bin/download without session", async () => {
    for (const [p, m] of [
      ["/api/drive/trash", "POST"], ["/api/drive/restore", "POST"], ["/api/drive/upload", "POST"],
      ["/api/drive/upload-url", "POST"], ["/api/drive/rename", "PATCH"], ["/api/drive/sync", "POST"],
      ["/api/folders", "POST"], ["/api/folders", "PATCH"], ["/api/folders", "DELETE"],
      ["/api/users", "PATCH"], ["/api/users", "DELETE"], ["/api/users/invite", "POST"],
      ["/api/approvals", "POST"], ["/api/storage", "POST"]
    ] as const) {
      const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json" }, body: "{}" });
      expect([400, 401, 307]).toContain(r.status);
    }
    for (const p of ["/api/users", "/api/drive/bin", "/api/activity", "/api/storage", "/api/notifications", "/api/health", "/api/drive/accounts", "/api/plans", "/api/profile"]) {
      const r = await get(p);
      expect([401, 403, 307]).toContain(r.status);
    }
    const dl = await get("/api/drive/download?file_id=00000000-0000-0000-0000-000000000000");
    expect([400, 401, 307, 404]).toContain(dl.status);
  });
  it("gates the Google OAuth start route", async () => {
    const r = await get("/api/auth/google", false);
    expect([302, 403]).toContain(r.status);
  });
  it("validates access requests and login-attempt reports without a session", async () => {
    const bad = await fetch(`${BASE}/api/access-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(bad.status).toBe(400);
    const get = await fetch(`${BASE}/api/access-requests`);
    expect(get.status).toBe(405);
    const attempt = await fetch(`${BASE}/api/auth/login-attempt`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(attempt.status).toBe(400);
  });
  it("serves PWA + brand assets publicly", async () => {
    expect((await get("/manifest.json")).status).toBe(200);
    expect((await get("/logo.png")).status).toBe(200);
    expect((await get("/logo.svg")).status).toBe(200);
    expect((await get("/sw.js")).status).toBe(200);
  });
});
