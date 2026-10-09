import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriveLike } from "@/lib/google-drive";

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
// `noparent` = account rows with no recorded parent (old mirrors): placeless
// but account-confined — shown, never leaked across accounts.
export async function inScopeGoogleIds(
  db: { from(t: string): any },
  accountId: string, rootId: string | null
): Promise<{ ids: Set<string>; noparent: Set<string> } | null> {
  if (!rootId) return null; // whole My Drive = everything in scope
  // Paginated: a 5000-row cap would silently amputate big drives and hide
  // in-scope files, so walk the whole account slice in chunks.
  const rows: { google_file_id: string; google_parent_id: string | null }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from("file_index").select("google_file_id,google_parent_id")
      .eq("drive_account_id", accountId).not("google_file_id", "is", null).range(off, off + 999);
    const chunk = ((data ?? []) as { google_file_id: string; google_parent_id: string | null }[]);
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  const children = new Map<string, string[]>();
  const noparent = new Set<string>();
  for (const r of rows) {
    if (r.google_parent_id) {
      const l = children.get(r.google_parent_id) ?? [];
      l.push(r.google_file_id);
      children.set(r.google_parent_id, l);
    } else {
      noparent.add(r.google_file_id);
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
  return { ids: seen, noparent };
}

// All indexed descendants of one Google folder (same account): the rows that
// must follow it into the Recovery Bin on trash (Drive hides the subtree;
// the index has to match) and out of it on restore.
export async function googleDescendants(
  db: { from(t: string): any },
  accountId: string, googleId: string
): Promise<string[]> {
  const rows: { id: string; google_file_id: string; google_parent_id: string | null }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from("file_index").select("id,google_file_id,google_parent_id")
      .eq("drive_account_id", accountId).not("google_file_id", "is", null).range(off, off + 999);
    const chunk = ((data ?? []) as { id: string; google_file_id: string; google_parent_id: string | null }[]);
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  const children = new Map<string, string[]>();
  for (const r of rows) {
    if (r.google_parent_id) {
      const l = children.get(r.google_parent_id) ?? [];
      l.push(r.id);
      children.set(r.google_parent_id, l);
    }
  }
  const out: string[] = [];
  const stack = [...(children.get(googleId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.includes(id)) continue;
    out.push(id);
    const gid = rows.find((r) => r.id === id)?.google_file_id;
    if (gid) for (const c of children.get(gid) ?? []) stack.push(c);
  }
  return out;
}

// Recovery Bin membership: trashed rows must not be servable anywhere else.
// Every byte-serving or mutating route checks this (the listing + tree filter
// separately). Restore/purge/bin read the bin directly and never call this.
export async function isBinned(db: { from(t: string): any }, fileId: string): Promise<boolean> {
  const { data } = await db.from("recovery_bin").select("file_id").eq("file_id", fileId).maybeSingle();
  return !!data;
}
export function binnedResponse(): Response {
  return Response.json({ error: "this file is in the Recovery Bin — restore it first" }, { status: 409 });
}

// Byte-path scope enforcement. The listing hides out-of-scope rows, but every
// endpoint that TOUCHES bytes must check again: row UUIDs outlive listings
// (a member who saw a file before a re-scope keeps its id forever), and live
// g: ids are caller-supplied. Without this, ?raw=1&file_id=g:<acct>:<anyId>
// streams ANY file in the account to ANY signed-in member.
//
// Cached per account (60 s): scope sets only change on re-scope + resync.
// Fail-closed: an unresolvable scope denies.
//
// Indexed rows: pass when there is no google pin, no account pin, or the
// account is unscoped/disabled (those cases are handled by their own rules).
export interface ScopeAccount { id: string; root_id: string | null; status: string }
const scopeCache = new Map<string, { at: number; ids: Set<string>; noparent: Set<string> }>();
const SCOPE_TTL = 60_000;
export function bustScopeCache(accountId?: string) {
  if (accountId) scopeCache.delete(accountId);
  else scopeCache.clear();
}
export async function googleInScope(
  db: { from(t: string): any },
  accounts: ScopeAccount[],
  accountId?: string | null,
  googleId?: string | null
): Promise<boolean> {
  if (!googleId || !accountId) return true;
  const acct = accounts.find((a) => a.id === accountId);
  if (!acct || acct.status !== "active" || !acct.root_id) return true;
  const hit = scopeCache.get(accountId);
  let cached = hit && Date.now() - hit.at < SCOPE_TTL ? hit : null;
  if (!cached) {
    const scope = await inScopeGoogleIds(db, accountId, acct.root_id);
    const ids = scope?.ids ?? new Set<string>();
    const noparent = scope?.noparent ?? new Set<string>();
    scopeCache.set(accountId, { at: Date.now(), ids, noparent });
    cached = { at: Date.now(), ids, noparent };
  }
  // Placeless account rows show (account-confined, never cross-account).
  return cached.ids.has(googleId) || cached.noparent.has(googleId);
}

// Live g: ids have no index row: walk the file's real Drive ancestry (≤12
// hops) and accept only if it reaches the account's configured root.
export async function liveInScope(drive: DriveLike, rootId: string | null, googleId: string): Promise<boolean> {
  if (!rootId || !drive) return true; // unscoped account = whole drive in scope
  try {
    let cur: string | null = googleId;
    for (let i = 0; i < 12 && cur; i++) {
      if (cur === rootId) return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta: any = await drive.files.get({ fileId: cur, fields: "parents", supportsAllDrives: true });
      cur = (meta?.data?.parents?.[0] as string | undefined) ?? null;
    }
    return false;
  } catch {
    return false; // unreadable ancestry = deny
  }
}
