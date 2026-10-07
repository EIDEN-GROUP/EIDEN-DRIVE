import { describe, expect, it } from "vitest";
import { windowed } from "@/components/ui/pagination-utils";

describe("pagination window", () => {
  it("shows every page when there are few", () => expect(windowed(1, 3)).toEqual([1, 2, 3]));
  it("keeps first, last and neighbours with ellipses in between", () => {
    expect(windowed(10, 20)).toEqual([1, "…", 9, 10, 11, "…", 20]);
  });
  it("stays compact at the edges", () => {
    expect(windowed(1, 20)).toEqual([1, 2, 3, 4, "…", 20]);
    expect(windowed(20, 20)).toEqual([1, "…", 17, 18, 19, 20]);
  });
  it("never repeats an ellipsis", () => {
    for (let p = 1; p <= 30; p++) { const w = windowed(p, 30); expect(w.some((x, i) => x === "…" && w[i + 1] === "…")).toBe(false); }
  });
});
