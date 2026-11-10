import { createHash, randomBytes } from "node:crypto";
import { adminClient } from "@/lib/supabase-admin";

// Public share links: unguessable token in the URL, sha256 stored.
// Anyone with the link (or token) gets read/preview only - never edit,
// never list beyond its target, never enumerate. Files, local folders and
// indexed Google folders can each be shared. The target's kind decides how
// the public viewer opens it.

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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
  kind: "file";
  file: {
    id: string; name: string; mime: string; size: number;
    storage_path: string | null; storage_bucket: string | null;
    google_file_id: string | null; drive_account_id: string | null;
    backends: string[];
  };
}

export interface SharedFolder {
  linkId: string;
  kind: "folder";
  folder: {
    id: string; name: string;
    source: "workspace" | "google";
    account: string | null; googleId: string | null;
    backends: string[];
  };
}

export type SharedTarget = SharedFile | SharedFolder;

export async function resolveShare(token: string): Promise<SharedTarget | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const db = adminClient();
  let row: { id: string; file_id: string | null; folder_id: string | null; expires_at: string } | null = null;
  try {
    const { data } = await db.from("share_links").select("id,file_id,folder_id,expires_at")
      .eq("token_hash", tokenHash(token)).maybeSingle();
    row = (data ?? null) as { id: string; file_id: string | null; folder_id: string | null; expires_at: string } | null;
  } catch {
    const { data } = await db.from("share_links").select("id,file_id,expires_at")
      .eq("token_hash", tokenHash(token)).maybeSingle();
    const l = (data ?? null) as { id: string; file_id: string; expires_at: string } | null;
    if (!l || new Date(l.expires_at).getTime() < Date.now()) return null;
    // fallback file id only
    return resolveFileTarget(l, db) as unknown as SharedTarget | null;
  }
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  if (row.folder_id) {
    const { data: f } = await db.from("folders").select("id,name").eq("id", row.folder_id).maybeSingle();
    if (!f) return null;
    return {
      linkId: row.id, kind: "folder",
      folder: { id: (f as { id: string }).id, name: (f as { name: string }).name, source: "workspace", account: null, googleId: null, backends: ["local"] },
    };
  }
  if (row.file_id) {
    const { data: fi } = await db.from("file_index").select("id,name,mime,size,storage_path,storage_bucket,google_file_id,drive_account_id,backends").eq("id", row.file_id).maybeSingle();
    if (!fi) return null;
    const f = fi as { id: string; name: string; mime: string; size: number; storage_path: string | null; storage_bucket: string | null; google_file_id: string | null; drive_account_id: string | null; backends: string[] };
    if (f.mime === "application/vnd.google-apps.folder") {
      return {
        linkId: row.id, kind: "folder",
        folder: { id: f.id, name: f.name, source: "google", account: f.drive_account_id, googleId: f.google_file_id, backends: f.backends },
      };
    }
    return { linkId: row.id, kind: "file", file: f };
  }
  return null;
}

async function resolveFileTarget(row: { id: string; file_id: string; expires_at: string }, db: ReturnType<typeof adminClient>) {
  const { data: fi } = await db.from("file_index").select("id,name,mime,size,storage_path,storage_bucket,google_file_id,drive_account_id,backends").eq("id", row.file_id).maybeSingle();
  if (!fi) return null;
  return { linkId: row.id, kind: "file" as const, file: fi };
}
