import { adminClient } from "@/lib/supabase-admin";
import { isBinned, googleInScope } from "@/lib/visibility";
import { subtreeIds } from "@/lib/folders";
import { driveDescendants } from "@/lib/folder-slack-mute";

export interface SharedChild {
  id: string; name: string; mime: string; size: number;
  account: string | null; google_file_id: string | null;
  folder_id: string | null;
}

export async function listSharedFolderChildren(folder: {
  source: "workspace" | "google"; id: string; account: string | null; googleId: string | null;
}): Promise<SharedChild[]> {
  const db = adminClient();
  const out: SharedChild[] = [];
  if (folder.source === "workspace") {
    const { data: subDirs } = await db.from("folders").select("id,name").eq("parent", folder.id);
    for (const f of ((subDirs ?? []) as { id: string; name: string }[])) {
      // synthetic child entry for a nested workspace folder (no Google bytes)
      out.push({ id: `folder:${f.id}`, name: f.name, mime: "application/vnd.google-apps.folder", size: 0, account: null, google_file_id: null, folder_id: f.id });
    }
    const { data: files } = await db.from("file_index").select("id,name,mime,size,folder,google_file_id,drive_account_id").eq("folder", folder.id).limit(200);
    for (const f of ((files ?? []) as { id: string; name: string; mime: string; size: number; folder: string | null; google_file_id: string | null; drive_account_id: string | null }[])) {
      out.push({ id: f.id, name: f.name, mime: f.mime, size: f.size, account: f.drive_account_id, google_file_id: f.google_file_id, folder_id: f.folder });
    }
    return out;
  }
  if (!folder.googleId || !folder.account) return out;
  const { data: rows } = await db.from("file_index").select("id,name,mime,size,google_file_id,drive_account_id,google_parent_id").eq("drive_account_id", folder.account).eq("google_parent_id", folder.googleId).limit(200);
  for (const r of ((rows ?? []) as { id: string; name: string; mime: string; size: number; google_file_id: string | null; drive_account_id: string | null; google_parent_id: string | null }[])) {
    out.push({ id: r.id, name: r.name, mime: r.mime, size: r.size, account: r.drive_account_id, google_file_id: r.google_file_id, folder_id: null });
  }
  return out;
}

// Is the given index-row id a genuine direct or nested child of the folder
// target? Used to authorize raw/media downloads from a folder share without
// leaking any other file.
export async function resolveSharedChildFile(folder: {
  source: "workspace" | "google"; id: string; account: string | null; googleId: string | null;
}, fileId: string): Promise<{ id: string; name: string; mime: string; size: number; storage_path: string | null; storage_bucket: string | null; google_file_id: string | null; drive_account_id: string | null; backends: string[] } | null> {
  const db = adminClient();
  const { data } = await db.from("file_index").select("id,name,mime,size,storage_path,storage_bucket,google_file_id,drive_account_id,backends,folder,google_parent_id").eq("id", fileId).maybeSingle();
  const row = (data ?? null) as null | {
    id: string; name: string; mime: string; size: number; storage_path: string | null; storage_bucket: string | null;
    google_file_id: string | null; drive_account_id: string | null; backends: string[]; folder: string | null; google_parent_id: string | null;
  };
  if (!row) return null;
  if (await isBinned(db, row.id)) return null;
  if (folder.source === "workspace") {
    if (!row.folder) return null;
    // direct child or any nested descendant
    const allowed = new Set<string>([folder.id]);
    const subtree = await subtreeIds(db as never, folder.id);
    if (subtree) for (const id of subtree) allowed.add(id);
    if (!allowed.has(row.folder)) return null;
  } else {
    if (!folder.account || row.drive_account_id !== folder.account) return null;
    if (!folder.googleId || !row.google_file_id) return null;
    // walk up from the file's parent to the shared google id
    let cur: string | null = row.google_parent_id;
    const seen = new Set<string>();
    let hit = false;
    for (let i = 0; i < 50 && cur && !seen.has(cur); i++) {
      if (cur === folder.googleId) { hit = true; break; }
      seen.add(cur);
      const { data: p } = await db.from("file_index").select("google_parent_id").eq("google_file_id", cur).eq("drive_account_id", folder.account).maybeSingle();
      const prow = (p ?? null) as { google_parent_id?: string | null } | null;
      cur = prow?.google_parent_id ?? null;
    }
    if (!hit && row.google_parent_id !== folder.googleId) return null;
  }
  return {
    id: row.id, name: row.name, mime: row.mime, size: row.size,
    storage_path: row.storage_path, storage_bucket: row.storage_bucket,
    google_file_id: row.google_file_id, drive_account_id: row.drive_account_id, backends: row.backends,
  };
}
