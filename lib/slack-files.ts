import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { accessContext, canTouch, googlePinOf, type Me } from "@/lib/visibility";

// File access FOR the Slack bot, evaluated AS the linked Eiden user — the
// same helpers, the same rules as the app (dept inheritance, tags,
// Confidential, scope). There is deliberately no separate permission layer:
// a Slack identity sees exactly what its linked Eiden account sees, and an
// unlinked identity sees nothing (callers check the link first).

export interface BotFile {
  id: string; name: string; mime: string; size: number | null;
  folder: string | null; owner: string | null;
  google_file_id: string | null; google_parent_id: string | null; drive_account_id: string | null;
  backends: string[];
}

const COLS = "id,name,mime,size,folder,owner,google_file_id,google_parent_id,drive_account_id,backends";

/** Load the linked Eiden profile as a permission identity (null = gone/disabled link). */
export async function botIdentity(eidenUserId: string): Promise<Me | null> {
  if (!hasAdminClient()) return null;
  try {
    const { data } = await adminClient().from("profiles")
      .select("id,role,department_tag").eq("id", eidenUserId).maybeSingle();
    const p = (data ?? null) as { id: string; role: string; department_tag: string | null } | null;
    if (!p) return null;
    return { id: p.id, role: p.role, department_tag: p.department_tag };
  } catch {
    return null;
  }
}

async function filterVisible(db: ReturnType<typeof adminClient>, me: Me, rows: BotFile[]): Promise<BotFile[]> {
  const out: BotFile[] = [];
  for (const r of rows) {
    if (r.google_file_id && r.drive_account_id) {
      // Scope first (cheap, no Drive calls): out-of-scope rows hide.
      const { googleInScope } = await import("@/lib/visibility");
      const { getAccounts } = await import("@/lib/drive-accounts");
      if (!(await googleInScope(db, await getAccounts(), r.drive_account_id, r.google_file_id))) continue;
    }
    const gate = await canTouch(db, me,
      { id: r.id, owner: r.owner ?? "", folder: r.folder }, googlePinOf(r));
    if (gate.ok) out.push(r);
  }
  return out;
}

/** Name search within the linked user's visible files (bounded page). */
export async function botSearchFiles(me: Me, query: string, limit = 10, offset = 0): Promise<{ files: BotFile[]; hasMore: boolean }> {
  const db = adminClient();
  const { data, error } = await db.from("file_index").select(COLS)
    .ilike("name", `%${query.replace(/[%_\\]/g, "")}%`)
    .order("updated_at", { ascending: false }).range(offset, offset + limit);
  if (error || !data) return { files: [], hasMore: false };
  const rows = (data ?? []) as BotFile[];
  // Over-fetch by one page when filtering may drop rows: cheap + bounded.
  const visible = await filterVisible(db, me, rows);
  return { files: visible.slice(0, limit), hasMore: rows.length > limit || visible.length > limit };
}

/** Recently updated visible files. */
export async function botRecentFiles(me: Me, limit = 10): Promise<BotFile[]> {
  const db = adminClient();
  const { data } = await db.from("file_index").select(COLS)
    .order("updated_at", { ascending: false }).limit(50);
  const visible = await filterVisible(db, me, ((data ?? []) as BotFile[]));
  return visible.slice(0, limit);
}

/** One file, authorized (null = missing or not visible — same response either way, no oracle). */
export async function botGetFile(me: Me, fileId: string): Promise<BotFile | null> {
  const db = adminClient();
  const { data } = await db.from("file_index").select(COLS).eq("id", fileId).maybeSingle();
  const row = (data ?? null) as BotFile | null;
  if (!row) return null;
  const visible = await filterVisible(db, me, [row]);
  return visible[0] ?? null;
}

/** Is there a live (unexpired) public share link for this file? Only then may
 *  a conversation-visible unfurl show full details. */
export async function hasLiveShareLink(fileId: string): Promise<boolean> {
  if (!hasAdminClient()) return false;
  try {
    const { data } = await adminClient().from("share_links").select("id")
      .eq("file_id", fileId).gt("expires_at", new Date().toISOString()).limit(1);
    return !!data?.length;
  } catch {
    return false;
  }
}

/** Workspace folders the linked user may browse (for modal folder navigation). */
export async function botListFolders(me: Me, parent: string | null): Promise<{ id: string; name: string }[]> {
  const db = adminClient();
  const ctx = await accessContext(db, me);
  let q = db.from("folders").select("id,name,parent").order("name").limit(100);
  q = parent ? q.eq("parent", parent) : q.is("parent", null);
  const { data } = await q;
  const rows = ((data ?? []) as { id: string; name: string }[]);
  if (ctx.folders === null) return rows;
  return rows.filter((f) => ctx.folders!.has(f.id));
}

/** Visible files directly inside one workspace folder. */
export async function botListFolderFiles(me: Me, folderId: string, limit = 20, offset = 0): Promise<{ files: BotFile[]; hasMore: boolean }> {
  const db = adminClient();
  const { data } = await db.from("file_index").select(COLS)
    .eq("folder", folderId).order("name").range(offset, offset + limit);
  const rows = ((data ?? []) as BotFile[]);
  const visible = await filterVisible(db, me, rows);
  return { files: visible.slice(0, limit), hasMore: rows.length > limit };
}
