import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret, vaultSessionValid } from "../../lib/vault";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("vault crypto round-trip (AES-256-GCM)", () => {
  it("decrypts what it encrypts, and rejects wrong keys", async () => {
    const p = await encryptSecret("smtp-password-123", KEY);
    expect(p.iv).toBeTruthy();
    expect(p.ct).toBeTruthy();
    expect(await decryptSecret(p, KEY)).toBe("smtp-password-123");
    await expect(decryptSecret(p, Buffer.alloc(32, 8).toString("base64"))).rejects.toThrow();
  });
});

describe("vaultSessionValid (6h window)", () => {
  it("accepts fresh auth, rejects stale/missing", () => {
    expect(vaultSessionValid(new Date().toISOString())).toBe(true);
    expect(vaultSessionValid(new Date(Date.now() - 7 * 3600_000).toISOString())).toBe(false);
    expect(vaultSessionValid(null)).toBe(false);
  });
});
