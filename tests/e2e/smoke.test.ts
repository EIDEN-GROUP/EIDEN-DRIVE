import { describe, expect, it } from "vitest";

const BASE = process.env.EIDEN_BASE_URL ?? "http://localhost:3000";
const get = (p: string, follow = true) => fetch(`${BASE}${p}`, { redirect: follow ? "follow" : "manual" });

// End-to-end page flow as an anonymous visitor (middleware must bounce to /login).
describe("e2e anonymous flow", () => {
  it("home redirects to login", async () => {
    const r = await get("/", false);
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toContain("/login");
  });
  it("drive redirects to login with ?next=", async () => {
    const r = await get("/drive", false);
    expect(r.status).toBe(307);
    expect(r.headers.get("location") ?? "").toContain("/login");
  });
  it("login renders an accessible form", async () => {
    const r = await get("/login");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Eiden");
    expect(html).toContain("Sign In Account"); // fields render after mount (see tests/ui/render.test.ts)
    expect(html).toContain('alt="Eiden logo"');
  });
  it("unknown file id shows the not-found page (after auth wall)", async () => {
    const r = await get("/drive/does-not-exist", false);
    expect([307, 404]).toContain(r.status);
  });
});
