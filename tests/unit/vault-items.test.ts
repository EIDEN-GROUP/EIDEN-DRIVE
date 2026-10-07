import { describe, expect, it, afterEach } from "vitest";
import { openItem, sealItem, vaultKey } from "@/lib/vault";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER = Buffer.alloc(32, 9).toString("base64");
const doc = { label: "Hostinger", username: "admin@eiden-group.com", url: "https://hpanel.hostinger.com", secret: "p@ss w0rd ✓", notes: "2FA on phone" };

describe("vault item sealing", () => {
  afterEach(() => { delete process.env.VAULT_KEK; });

  it("round-trips a document", async () => {
    const blob = await sealItem(doc, KEY);
    expect(await openItem(blob, KEY)).toEqual(doc);
  });
  it("never stores the secret in readable form", async () => {
    const blob = await sealItem(doc, KEY);
    const raw = Buffer.from(blob, "base64").toString("utf8");
    expect(blob).not.toContain("w0rd");
    expect(raw).not.toContain("w0rd");
    expect(raw).not.toContain("Hostinger");
  });
  it("uses a fresh IV every time", async () => {
    expect(await sealItem(doc, KEY)).not.toBe(await sealItem(doc, KEY));
  });
  it("rejects the wrong key and tampered data (GCM auth)", async () => {
    const blob = await sealItem(doc, KEY);
    await expect(openItem(blob, OTHER)).rejects.toBeTruthy();
    const env = JSON.parse(Buffer.from(blob, "base64").toString("utf8"));
    env.ct = Buffer.from(Buffer.from(env.ct, "base64").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64");
    await expect(openItem(Buffer.from(JSON.stringify(env)).toString("base64"), KEY)).rejects.toBeTruthy();
  });
  it("vaultKey() only accepts a 32-byte base64 key", () => {
    expect(vaultKey()).toBeNull();
    process.env.VAULT_KEK = KEY; expect(vaultKey()).toBe(KEY);
    process.env.VAULT_KEK = Buffer.alloc(16).toString("base64"); expect(vaultKey()).toBeNull();
    process.env.VAULT_KEK = "not base64 at all !!"; expect(vaultKey()).toBeNull();
  });
});
