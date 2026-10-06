import { describe, expect, it } from "vitest";
import { hotp, newSecret, otpauthUri, verifyTotp } from "@/lib/totp";

// RFC 4226 test secret "12345678901234567890" in base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP", () => {
  it("matches RFC 4226 HOTP vectors", () => {
    expect(hotp(RFC_SECRET, 0)).toBe("755224");
    expect(hotp(RFC_SECRET, 1)).toBe("287082");
    expect(hotp(RFC_SECRET, 9)).toBe("520489");
  });
  it("matches RFC 6238 vector at T=59s (counter 1)", () => {
    expect(verifyTotp(RFC_SECRET, "287082", 59_000)).toBe(true);
  });
  it("accepts ±1 step drift, rejects further", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 3), now)).toBe(false);
  });
  it("rejects malformed tokens", () => {
    for (const t of ["", "12345", "1234567", "abcdef", "000000 "]) expect(verifyTotp(RFC_SECRET, t)).toBe(false);
  });
  it("generates valid base32 secrets and otpauth URIs", () => {
    const s = newSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri(s, "aya")).toContain(`secret=${s}`);
  });
});
