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
