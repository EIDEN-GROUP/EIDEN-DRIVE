// Vault crypto — AES-256-GCM per item. KEK id from Supabase Vault (never in repo).
// WebCrypto-based so it runs on Edge + browser. Key wrapping stubbed until KMS wired (P2),
// but format is final: {iv, ct, kid}.
export async function encryptSecret(plaintext: string, keyB64: string) {
  const keyBytes = Uint8Array.from(Buffer.from(keyB64, "base64"));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { iv: Buffer.from(iv).toString("base64"), ct: Buffer.from(ct).toString("base64") };
}

export async function decryptSecret(payload: { iv: string; ct: string }, keyB64: string) {
  const keyBytes = Uint8Array.from(Buffer.from(keyB64, "base64"));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Uint8Array.from(Buffer.from(payload.iv, "base64")) },
    key,
    Uint8Array.from(Buffer.from(payload.ct, "base64"))
  );
  return new TextDecoder().decode(pt);
}

export const VAULT_SESSION_HOURS = 6;
export function vaultSessionValid(authedAt: string | null): boolean {
  if (!authedAt) return false;
  return Date.now() - new Date(authedAt).getTime() < VAULT_SESSION_HOURS * 3600_000;
}

// ── Item sealing ────────────────────────────────────────────────────────────
// One vault item = a small JSON document, encrypted as a whole with AES-256-GCM under a server-held key.
// The key (`VAULT_KEK`, 32 random bytes, base64) lives ONLY in the server environment — never in the DB, repo or browser.
// Stored form (vault_items.enc_blob): base64(JSON{ v:1, iv, ct }). Tampering fails GCM authentication on open.
export interface VaultDoc { label: string; username?: string; url?: string; secret: string; notes?: string }

export function vaultKey(): string | null {
  const k = process.env.VAULT_KEK?.trim();
  if (!k) return null;
  try { return Buffer.from(k, "base64").length === 32 ? k : null; } catch { return null; }
}

export async function sealItem(doc: VaultDoc, keyB64: string): Promise<string> {
  const { iv, ct } = await encryptSecret(JSON.stringify(doc), keyB64);
  return Buffer.from(JSON.stringify({ v: 1, iv, ct })).toString("base64");
}

export async function openItem(blob: string, keyB64: string): Promise<VaultDoc> {
  const env = JSON.parse(Buffer.from(blob, "base64").toString("utf8")) as { v: number; iv: string; ct: string };
  if (env.v !== 1) throw new Error("unsupported vault item version");
  return JSON.parse(await decryptSecret({ iv: env.iv, ct: env.ct }, keyB64)) as VaultDoc;
}
