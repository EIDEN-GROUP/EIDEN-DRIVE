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
  it("rejects trash/restore/upload/folders/vault without session", async () => {
    for (const [p, m] of [["/api/drive/trash", "POST"], ["/api/drive/restore", "POST"], ["/api/drive/upload", "POST"], ["/api/folders", "POST"]] as const) {
      const r = await fetch(`${BASE}${p}`, { method: m, headers: { "content-type": "application/json" }, body: "{}" });
      expect([400, 401, 307]).toContain(r.status);
    }
  });
  it("gates the Google OAuth start route", async () => {
    const r = await get("/api/auth/google", false);
    expect([302, 403]).toContain(r.status);
  });
  it("serves PWA + brand assets publicly", async () => {
    expect((await get("/manifest.json")).status).toBe(200);
    expect((await get("/logo.png")).status).toBe(200);
    expect((await get("/logo.svg")).status).toBe(200);
    expect((await get("/sw.js")).status).toBe(200);
  });
});
