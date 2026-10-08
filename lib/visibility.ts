import type { SupabaseClient } from "@supabase/supabase-js";

// Workspace visibility: who may SEE a file/folder.
//   - admins/managers: everything (they run the place).
//   - members: own files, Workspace commons (no folder), and folders carrying
//     their department tag (or no tag). Confidential folders are invisible
//     unless you own the file.
// Google-drive rows carry no dept tags — shared drives are company-wide, so
// members see whatever is inside the account's configured scope. The SCOPE
// (which subtree) is enforced separately via inScopeGoogleIds().
export interface Me { id: string; role: string; department_tag?: string | null }

export function isManager(role: string): boolean {
  return role === "admin" || role === "manager";
}

export interface FolderBits { id: string; dept: string | null; classification: string | null }

export function visibleFolderIds(folders: FolderBits[], me: Me): Set<string> | null {
  if (isManager(me.role)) return null; // null = all visible
  const mine = (me.department_tag ?? "").trim().toLowerCase();
  const out = new Set<string>();
  for (const f of folders) {
    if ((f.classification ?? "Internal") === "Confidential") continue;
    const d = (f.dept ?? "").trim().toLowerCase();
    if (!d || (mine && d === mine)) out.add(f.id);
  }
  return out;
}

export async function loadFolders(db: SupabaseClient): Promise<FolderBits[]> {
  const { data } = await db.from("folders").select("id,dept,classification").limit(2000);
  return ((data ?? []) as FolderBits[]);
}

// PostgREST OR-leg for file_index: owner=me OR no folder OR folder in set.
export function fileOrClause(me: Me, visible: Set<string> | null): string {
  if (visible === null) return "";
  const legs = [`owner.eq.${me.id}`, "folder.is.null"];
  if (visible.size) legs.push(`folder.in.(${[...visible].join(",")})`);
  return legs.join(",");
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
