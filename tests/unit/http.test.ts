import { describe, expect, it } from "vitest";
import { z } from "zod";
import { escapeLike, parseJson, safeEqual } from "@/lib/http";

const req = (body: string) => new Request("http://x/api", { method: "POST", body, headers: { "content-type": "application/json" } });

describe("http helpers", () => {
  it("parseJson returns 400 (not a throw) on bad input", async () => {
    const bad = await parseJson(req(JSON.stringify({ file_id: "nope" })), z.object({ file_id: z.string().uuid() }));
    expect(bad.error?.status).toBe(400);
    const notJson = await parseJson(req("{{{"), z.object({}));
    expect(notJson.error?.status).toBe(400);
  });
  it("parseJson passes valid data", async () => {
    const ok = await parseJson(req(JSON.stringify({ n: 1 })), z.object({ n: z.number() }));
    expect(ok.data).toEqual({ n: 1 });
  });
  it("escapeLike neutralises wildcards", () => {
    expect(escapeLike("100%_done\\")).toBe("100\\%\\_done\\\\");
  });
  it("safeEqual is exact and length-safe", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
