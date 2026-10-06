import { describe, expect, it } from "vitest";

const BASE = process.env.EIDEN_BASE_URL ?? "http://localhost:3000";

// UI assertions on server-rendered HTML (no browser needed): semantics, labels,
// touch-target classes, viewport, and the no-emoji-icons rule.
describe("UI render checks (/login)", () => {
  let html = "";
  it("loads", async () => {
    const r = await fetch(`${BASE}/login`);
    expect(r.status).toBe(200);
    html = await r.text();
  });
  // The form fields are intentionally NOT in the server HTML (rendered after mount to avoid extension-induced
  // hydration errors). Label/field/touch-target checks live in the browser test: tests/ux/checklist.md.
  it("has exactly one h1 and a loading placeholder for the form", () => {
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).toContain("Sign In Account");
    expect(html).toContain('aria-busy="true"');
  });
  it("uses SVG icons, not emoji icons", () => {
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
  it("responsive viewport meta present", () => {
    expect(html).toContain("width=device-width");
  });
  it("images carry alt text", () => {
    const imgs = [...html.matchAll(/<img[^>]*>/g)];
    for (const m of imgs) expect(m[0]).toContain("alt=");
  });
});
