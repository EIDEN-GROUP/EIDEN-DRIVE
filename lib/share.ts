import { createHash, randomBytes } from "node:crypto";
import { adminClient } from "@/lib/supabase-admin";

// Public share links: unguessable token in the URL, sha256 stored.
// Anyone with the link can PREVIEW (never edit, never list, never enumerate).
// Links expire (default 30 days) and die with the file (on delete cascade).

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Cheap in-memory throttle for the public endpoints (per token+ip, 60/min).
// Restarts clear it — fine, it's abuse-damping, not a security boundary
// (the boundary is the 256-bit token itself).
const hits = new Map<string, { n: number; at: number }>();
export function throttled(key: string, limit = 60): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.at > 60_000) { hits.set(key, { n: 1, at: now }); return false; }
  h.n++;
  return h.n > limit;
}

export interface SharedFile {
  linkId: string;
  file: { id: string; name: string; mime: string; size: number; storage_path: string | null; google_file_id: string | null; drive_account_id: string | null; backends: string[] };
}

export async function resolveShare(token: string): Promise<SharedFile | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const db = adminClient();
  const { data: link } = await db.from("share_links").select("id,file_id,expires_at").eq("token_hash", tokenHash(token)).maybeSingle();
  const l = link as { id: string; file_id: string; expires_at: string } | null;
  if (!l || new Date(l.expires_at).getTime() < Date.now()) return null;
  const { data: f } = await db.from("file_index").select("id,name,mime,size,storage_path,google_file_id,drive_account_id,backends").eq("id", l.file_id).maybeSingle();
  if (!f) return null;
  return { linkId: l.id, file: f as SharedFile["file"] };
}
