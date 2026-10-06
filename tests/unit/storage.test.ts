import { describe, expect, it, vi } from "vitest";

// Regression: upload/download links must be minted with the service role, never the user's JWT
// (user JWT → "new row violates row-level security policy" from Storage).
const upload = vi.fn(async () => ({ data: { signedUrl: "https://s/up", token: "t", path: "p" }, error: null }));
const signed = vi.fn(async () => ({ data: { signedUrl: "https://s/down" }, error: null }));
vi.mock("@/lib/supabase-admin", () => ({
  adminClient: () => ({ storage: { from: (b: string) => { expect(b).toBe("eiden-uploads"); return { createSignedUploadUrl: upload, createSignedUrl: signed }; } } })
}));
vi.mock("@/lib/supabase-server", () => ({ createClient: () => { throw new Error("must not use the user client for storage"); } }));

import { signedDownloadUrl, signedUploadUrl } from "@/lib/storage";

describe("storage helpers", () => {
  it("sign upload URLs with the service role", async () => {
    const r = await signedUploadUrl("u1/a.png", "image/png");
    expect(r.signedUrl).toBe("https://s/up");
    expect(upload).toHaveBeenCalledWith("u1/a.png");
  });
  it("sign 5-minute download URLs with the service role", async () => {
    expect(await signedDownloadUrl("u1/a.png")).toBe("https://s/down");
    expect(signed).toHaveBeenCalledWith("u1/a.png", 300);
  });
  it("surface Storage errors", async () => {
    upload.mockResolvedValueOnce({ data: null as never, error: { message: "Bucket not found" } as never });
    await expect(signedUploadUrl("x", "y")).rejects.toThrow("Bucket not found");
  });
});
