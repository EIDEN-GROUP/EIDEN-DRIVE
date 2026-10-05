import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase-server", () => ({
  createClient: () => ({ from: () => { throw new Error("no-db-in-unit"); } })
}));

import { storageAlert, isMassDelete, isLargeDownload } from "../../lib/alerts";

describe("storageAlert", () => {
  it("fires at 80% and 95% thresholds", () => {
    expect(storageAlert(1, 5)).toBeNull();
    expect(storageAlert(4.1, 5)).toBe("storage-80");
    expect(storageAlert(4.8, 5)).toBe("storage-95");
  });
  it("guards empty totals", () => {
    expect(storageAlert(5, 0)).toBeNull();
  });
});

describe("heuristics", () => {
  it("flags mass deletes (>=20 files / 10 min)", () => {
    expect(isMassDelete(20, 10)).toBe(true);
    expect(isMassDelete(5, 10)).toBe(false);
  });
  it("flags large downloads (>=2 GB)", () => {
    expect(isLargeDownload(3 * 1024 ** 3)).toBe(true);
    expect(isLargeDownload(100 * 1024 ** 2)).toBe(false);
  });
});
