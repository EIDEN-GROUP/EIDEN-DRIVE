import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriveLike } from "@/lib/google-drive";

// Workspace visibility: who may SEE a file/folder.
//   - admins/managers: everything (they run the place).
//   - members, DEPARTMENT-TAG MODE: when the member's department name matches
//     an existing tag AND at least one file or folder carries that tag, the
//     member sees ONLY department content — files/folders carrying the tag
//     (including whole tagged-folder subtrees), files in department folders,
//     and files they own. Everything else (untagged commons, other
//     departments' content, untagged Google rows, unsynced live rows) hides.
//     Google-drive rows carry scope only, so they show in this mode solely
//     when tagged or owned.
//   - members, FALLBACK (no tag matches their department, or the matching tag
//     is assigned to nothing): all files and folders show by default — own
//     files, Workspace commons (no folder, no foreign tags), department
//     folders, and in-scope Google rows.
// Confidential folders are invisible unless you own the file (both modes).
// The SCOPE (which Drive subtree) is enforced separately via inScopeGoogleIds().
export interface Me { id: string; role: string; department_tag?: string | null }

export function isManager(role: string): boolean {
  return role === "admin" || role === "manager";
}

export function normDept(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export interface FolderBits { id: string; dept: string | null; classification: string | null; parent?: string | null }

export function visibleFolderIds(folders: FolderBits[], me: Me, extraIds?: Set<string>, strict = false): Set<string> | null {
  if (isManager(me.role)) return null; // null = all visible
  const mine = normDept(me.department_tag);
  const out = new Set<string>();
  for (const f of folders) {
    if ((f.classification ?? "Internal") === "Confidential") continue;
    const d = normDept(f.dept);
    // Strict department-tag mode: commons folders (no dept) hide — only the
    // member's department folders and tag-matched folders (extraIds) show.
    // Fallback keeps commons visible.
    if (strict ? (mine && d === mine) : (!d || (mine && d === mine))) out.add(f.id);
  }
  if (extraIds) for (const id of extraIds) out.add(id);
  return out;
}

export async function loadFolders(db: SupabaseClient): Promise<FolderBits[]> {
  const { data } = await db.from("folders").select("id,dept,classification,parent").limit(2000);
  return ((data ?? []) as FolderBits[]);
}

// PostgREST OR-leg for file_index: owner=me OR no folder OR folder in set.
// In strict department-tag mode the commons leg (folder.is.null) is dropped:
// folderless rows only show when owned or directly tagged (the tagged leg).
export function fileOrClause(me: Me, visible: Set<string> | null, taggedFileIds?: Set<string>, strict = false): string {
  if (visible === null) return "";
  const legs = [`owner.eq.${me.id}`];
  if (!strict) legs.push("folder.is.null");
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
  // Paginated: a single .limit(5000) would silently leak dept-tagged files
  // past the cap back into the commons leg.
  const rows: { file_id: string; tags: { name: string } | { name: string }[] }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from("file_tags").select("file_id,tags!inner(name)").range(off, off + 999);
    if (error) return [];
    const chunk = ((data ?? []) as { file_id: string; tags: { name: string } | { name: string }[] }[]);
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  const out: string[] = [];
  for (const r of rows) {
    const names = (Array.isArray(r.tags) ? r.tags : [r.tags]).map((t) => normDept(t?.name));
    if (names.length && !(mine && names.includes(mine))) out.push(r.file_id);
  }
  return [...new Set(out)];
}
// Full per-request access picture for a member: which folders are visible and
// which individual files carry their department's tag. Managers get nulls (= all).
// `strict` is the department-tag mode: the member's department matches a tag
// that is actually assigned somewhere, so only department content shows.
// Otherwise (no matching tag, or matching tag assigned to nothing) strict is
// false and everything shows by default (fallback).
export interface AccessContext {  folders: Set<string> | null;
  taggedFiles: Set<string>;
  deptTagId: string | null;
  strict: boolean;
}

// How many files/folders carry a tag (head counts — cheap, exact enough to
// decide strict vs fallback).
async function tagUsage(db: SupabaseClient, tagId: string): Promise<number> {
  const [{ count: fc }, { count: oc }] = await Promise.all([
    db.from("file_tags").select("file_id", { count: "exact", head: true }).eq("tag_id", tagId),
    db.from("folder_tags").select("folder_id", { count: "exact", head: true }).eq("tag_id", tagId)
  ]);
  return (fc ?? 0) + (oc ?? 0);
}

export async function accessContext(db: SupabaseClient, me: Me): Promise<AccessContext> {
  if (isManager(me.role)) return { folders: null, taggedFiles: new Set(), deptTagId: null, strict: false };
  const mine = normDept(me.department_tag);
  let deptTagId: string | null = null;
  const taggedFiles = new Set<string>();
  const tagMatchedFolders = new Set<string>();
  let strict = false;
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
      // Strict only when the tag is actually assigned somewhere — else the
      // member would stare at an empty drive (fallback: show everything).
      strict = taggedFiles.size + tagMatchedFolders.size > 0;
      if (!strict) {
        const used = await tagUsage(db, deptTagId);
        strict = used > 0;
        // Counts above are capped: if either leg hit its cap, assignments
        // exist by definition.
        if (!strict && ((ft ?? []).length >= 5000 || (fo ?? []).length >= 2000)) strict = true;
      }
    }
  }
  const all = await loadFolders(db);
  const folders = visibleFolderIds(all, me, tagMatchedFolders, strict);
  if (strict && folders) {
    // Tagged/department folders open their whole subtree: navigating into a
    // tagged folder must show its (untagged) children, or the folder is a
    // dead end. Confidential folders stay excluded (visibleFolderIds above
    // already dropped them — expansion only grows from visible roots and
    // never re-adds a Confidential node).
    const byParent = new Map<string, string[]>();
    const clsOf = new Map(all.map((f) => [f.id, f.classification ?? "Internal"]));
    for (const f of all) {
      const p = f.parent ?? null;
      if (p) {
        const l = byParent.get(p) ?? [];
        l.push(f.id);
        byParent.set(p, l);
      }
    }
    const stack = [...folders];
    while (stack.length) {
      const id = stack.pop()!;
      for (const c of byParent.get(id) ?? []) {
        if (!folders.has(c) && clsOf.get(c) !== "Confidential") { folders.add(c); stack.push(c); }
      }
    }
  }
  return { folders, taggedFiles, deptTagId, strict };
}

// Mutation gate: may `me` view/edit/trash/download this file? Managers always;
// owners always; otherwise the file's folder must be visible AND the file must
// not sit in a hidden tagged state (tag grants access, confidentiality denies).
// In strict department-tag mode the Workspace commons leg is gone: folderless
// files show only when owned or directly tagged.
export async function canTouch(
  db: SupabaseClient, me: Me,
  file: { id: string; owner: string; folder: string | null }
): Promise<{ ok: boolean; reason?: string }> {
  if (isManager(me.role)) return { ok: true };
  if (file.owner === me.id) return { ok: true };
  const ctx = await accessContext(db, me);
  // Direct tag grant on the file itself.
  if (ctx.taggedFiles.has(file.id)) return { ok: true };
  // A file carrying only OTHER departments' tags is hidden even inside a
  // visible folder (matches the listing's forbidden-tag filter — without this
  // a direct UUID bypassed it).
  const mine = normDept(me.department_tag);
  const { data: fileTags } = await db.from("file_tags").select("tag_id,tags!inner(name)").eq("file_id", file.id).limit(10);
  const tagNames = ((fileTags ?? []) as { tags: { name: string } | { name: string }[] }[])
    .flatMap((r) => (Array.isArray(r.tags) ? r.tags : [r.tags]).map((t) => normDept(t?.name)));
  if (tagNames.length > 0 && !(mine && tagNames.includes(mine))) {
    return { ok: false, reason: "this file belongs to another department" };
  }
  if (!file.folder) {
    if (ctx.strict) return { ok: false, reason: "this file is outside your department" };
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
  const byId = new Map<string, string>();
  for (const r of rows) byId.set(r.id, r.google_file_id);
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [...(children.get(googleId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    const gid = byId.get(id);
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
// Full bin id set, paginated: a single .limit(5000) would silently leak
// trashed rows past the cap back into listings and trees.
export async function allBinnedIds(db: { from(t: string): any }): Promise<Set<string>> {
  const out = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from("recovery_bin").select("file_id").range(off, off + 999);
    const chunk = ((data ?? []) as { file_id: string }[]);
    for (const r of chunk) out.add(r.file_id);
    if (chunk.length < 1000) break;
  }
  return out;
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
  if (!googleId) return true; // no google pin — nothing to scope-check
  if (!accountId) return true; // legacy null-account row: listing hides it from members; managers need byte access to clean up
  const acct = accounts.find((a) => a.id === accountId);
  if (!acct || acct.status !== "active") return false; // deleted/disabled account: deny, never fail open
  if (!acct.root_id) return true; // unscoped account = whole drive in scope
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
