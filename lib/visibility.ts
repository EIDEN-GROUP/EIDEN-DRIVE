import type { SupabaseClient } from "@supabase/supabase-js";

// Workspace visibility: who may SEE a file/folder.
//   - admins/managers: everything (they run the place).
//   - members: own files, Workspace commons (no folder, no tags), and anything
//     in their department — where "department" matches EITHER the folder's dept
//     field OR a tag with the same name attached to the folder or the file
//     (assigning dept "Clients" auto-unlocks everything tagged Clients).
//     Confidential folders are invisible unless you own the file.
// Google-drive rows carry no dept tags — shared drives are company-wide, so
// members see whatever is inside the account's configured scope. The SCOPE
// (which subtree) is enforced separately via inScopeGoogleIds().
export interface Me { id: string; role: string; department_tag?: string | null }

export function isManager(role: string): boolean {
  return role === "admin" || role === "manager";
}

export function normDept(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export interface FolderBits { id: string; dept: string | null; classification: string | null }

export function visibleFolderIds(folders: FolderBits[], me: Me, extraIds?: Set<string>): Set<string> | null {
  if (isManager(me.role)) return null; // null = all visible
  const mine = normDept(me.department_tag);
  const out = new Set<string>();
  for (const f of folders) {
    if ((f.classification ?? "Internal") === "Confidential") continue;
    const d = normDept(f.dept);
    if (!d || (mine && d === mine)) out.add(f.id);
  }
  if (extraIds) for (const id of extraIds) out.add(id);
  return out;
}

export async function loadFolders(db: SupabaseClient): Promise<FolderBits[]> {
  const { data } = await db.from("folders").select("id,dept,classification").limit(2000);
  return ((data ?? []) as FolderBits[]);
}

// PostgREST OR-leg for file_index: owner=me OR no folder OR folder in set.
export function fileOrClause(me: Me, visible: Set<string> | null, taggedFileIds?: Set<string>): string {
  if (visible === null) return "";
  const legs = [`owner.eq.${me.id}`, "folder.is.null"];
  if (visible.size) legs.push(`folder.in.(${[...visible].join(",")})`);
  if (taggedFileIds?.size) legs.push(`id.in.(${[...taggedFileIds].join(",")})`);
  return legs.join(",");
}

// File ids carrying a tag that is NOT the member's department — hidden from the
// list even when folderless (the folder.is.null commons leg would else leak them).
// Managers get [] (= nothing forbidden).
export async function forbiddenTaggedFileIds(db: SupabaseClient, me: Me): Promise<string[]> {
  if (isManager(me.role)) return [];
  const mine = normDept(me.department_tag);
  let q = db.from("file_tags").select("file_id,tags!inner(name)").limit(5000);
  const { data, error } = await q;
  if (error) return [];
  const out: string[] = [];
  for (const r of ((data ?? []) as { file_id: string; tags: { name: string } | { name: string }[] }[])) {
    const names = (Array.isArray(r.tags) ? r.tags : [r.tags]).map((t) => normDept(t?.name));
    if (names.length && !(mine && names.includes(mine))) out.push(r.file_id);
  }
  return [...new Set(out)];
}
// Full per-request access picture for a member: which folders are visible and
// which individual files carry their department's tag. Managers get nulls (= all).
export interface AccessContext {  folders: Set<string> | null;
  taggedFiles: Set<string>;
  deptTagId: string | null;
}

export async function accessContext(db: SupabaseClient, me: Me): Promise<AccessContext> {
  if (isManager(me.role)) return { folders: null, taggedFiles: new Set(), deptTagId: null };
  const mine = normDept(me.department_tag);
  let deptTagId: string | null = null;
  const taggedFiles = new Set<string>();
  const tagMatchedFolders = new Set<string>();
  if (mine) {
    const { data: tagRows } = await db.from("tags").select("id").ilike("name", mine).limit(1);
    const tagRow = ((tagRows ?? []) as { id: string }[])[0] ?? null;
    if (tagRow?.id) {
      deptTagId = tagRow.id;
      const [{ data: ft }, { data: fo }] = await Promise.all([
        db.from("file_tags").select("file_id").eq("tag_id", deptTagId).limit(5000),
        db.from("folder_tags").select("folder_id").eq("tag_id", deptTagId).limit(2000)
      ]);
      for (const r of ((ft ?? []) as { file_id: string }[])) taggedFiles.add(r.file_id);
      for (const r of ((fo ?? []) as { folder_id: string }[])) tagMatchedFolders.add(r.folder_id);
    }
  }
  const folders = await loadFolders(db).then((all) => visibleFolderIds(all, me, tagMatchedFolders));
  return { folders, taggedFiles, deptTagId };
}

// Mutation gate: may `me` view/edit/trash/download this file? Managers always;
// owners always; otherwise the file's folder must be visible AND the file must
// not sit in a hidden tagged state (tag grants access, confidentiality denies).
export async function canTouch(
  db: SupabaseClient, me: Me,
  file: { id: string; owner: string; folder: string | null }
): Promise<{ ok: boolean; reason?: string }> {
  if (isManager(me.role)) return { ok: true };
  if (file.owner === me.id) return { ok: true };
  const ctx = await accessContext(db, me);
  // Direct tag grant on the file itself.
  if (ctx.taggedFiles.has(file.id)) return { ok: true };
  if (!file.folder) {
    // Workspace commons: visible unless tagged for another department. Any tag
    // at all means it belongs somewhere — without our tag, hands off.
    const { data: tags } = await db.from("file_tags").select("tag_id").eq("file_id", file.id).limit(5);
    if ((tags ?? []).length > 0) return { ok: false, reason: "this file belongs to another department" };
    return { ok: true };
  }
  if (ctx.folders !== null && !ctx.folders.has(file.folder)) {
    return { ok: false, reason: "this file belongs to another department" };
  }
  return { ok: true };
}

// May `me` place new items into `folderId` (upload target, copy destination,
// new subfolder parent)? Commons always; otherwise the folder must be visible.
export async function folderUsable(db: SupabaseClient, me: Me, folderId: string | null): Promise<{ ok: boolean; reason?: string }> {
  if (isManager(me.role)) return { ok: true };
  if (!folderId) return { ok: true };
  const ctx = await accessContext(db, me);
  if (ctx.folders !== null && !ctx.folders.has(folderId)) {
    return { ok: false, reason: "you can't add to a folder outside your department" };
  }
  return { ok: true };
}

// In-scope google ids for one account: BFS from the configured root over the
// indexed (google_file_id → parent) map. Rows whose ancestry doesn't reach the
// root are out of scope (pre-scope leftovers, other trees) and stay hidden.
export async function inScopeGoogleIds(
  db: { from(t: string): any },
  accountId: string, rootId: string | null
): Promise<Set<string> | null> {
  if (!rootId) return null; // whole My Drive = everything in scope
  const { data } = await db.from("file_index").select("google_file_id,google_parent_id")
    .eq("drive_account_id", accountId).not("google_file_id", "is", null).limit(5000);
  const rows = ((data ?? []) as { google_file_id: string; google_parent_id: string | null }[]);
  const children = new Map<string, string[]>();
  for (const r of rows) {
    if (r.google_parent_id) {
      const l = children.get(r.google_parent_id) ?? [];
      l.push(r.google_file_id);
      children.set(r.google_parent_id, l);
    }
  }
  const seen = new Set<string>();
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of children.get(id) ?? []) if (!seen.has(c)) stack.push(c);
  }
  return seen;
}
