import { createHmac, randomBytes } from "node:crypto";

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — no dependency. Secrets are base32 like every authenticator app expects.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = "", out = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function b32decode(s: string): Buffer {
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error("bad base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

/** Accepts the current step ±1 (clock drift). */
export function verifyTotp(secret: string, token: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const step = Math.floor(now / 30_000);
  for (const d of [-1, 0, 1]) if (hotp(secret, step + d) === token) return true;
  return false;
}

export function otpauthUri(secret: string, account: string, issuer = "Eiden Drive"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
