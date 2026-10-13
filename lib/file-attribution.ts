import { adminClient, hasAdminClient } from "@/lib/supabase-admin";

// "Modified by" attribution for Get Info. Authoritative sources only:
//  1. audit_logs modification events (add/edit/rename/move/restore) — actor_name + ts.
//  2. versions rows (uploads v1 + content edits) — actor → username.
//  3. Google Drive lastModifyingUser for externally edited files.
// Views, downloads, shares, and unrelated reads are NEVER treated as edits.
// The original owner is never substituted for the most recent editor.
// Unresolvable attribution returns null — the client renders "Not recorded".

export const MODIFY_ACTIONS = ["add", "edit", "rename", "move", "restore"];

export interface Attribution {
  at: string; // ISO timestamp of the modification event
  by: string; // actor name as recorded (Eiden username or Google display name)
}

type Db = ReturnType<typeof adminClient>;

/** Latest app-side modification event for one file (null = none recorded). */
export async function latestFileAudit(db: Db, fileId: string): Promise<Attribution | null> {
  try {
    const { data } = await db.from("audit_logs")
      .select("ts,actor_name").eq("file_id", fileId).in("action", MODIFY_ACTIONS)
      .order("ts", { ascending: false }).limit(1).maybeSingle();
    const row = (data ?? null) as { ts?: string; actor_name?: string } | null;
    if (!row?.ts || !row.actor_name) return null;
    return { at: row.ts, by: row.actor_name };
  } catch {
    return null;
  }
}

/** Latest content version (upload v1 + FileEditor edits) as a fallback. */
export async function latestVersionAttribution(db: Db, fileId: string): Promise<Attribution | null> {
  try {
    const { data: v } = await db.from("versions")
      .select("ts,actor").eq("file_id", fileId)
      .order("ts", { ascending: false }).limit(1).maybeSingle();
    const ver = (v ?? null) as { ts?: string; actor?: string } | null;
    if (!ver?.ts) return null;
    let by: string | null = null;
    if (ver.actor) {
      try {
        const { data: p } = await db.from("profiles").select("username").eq("id", ver.actor).maybeSingle();
        by = ((p ?? {}) as { username?: string }).username ?? null;
      } catch { /* ignore */ }
    }
    if (!by) return null;
    return { at: ver.ts, by };
  } catch {
    return null;
  }
}

/**
 * Latest modification touching one workspace folder: actual folder
 * operations (detail.folder = id, or the folder's own name as logged by the
 * create route) plus modification events on current direct children —
 * whichever is newest. Never an arbitrary descendant: children are direct
 * members only, and the winner is the latest real event among both sets.
 */
export async function latestFolderAttribution(
  db: Db, folderId: string, folderName: string, childFileIds: string[]
): Promise<Attribution | null> {
  const cands: Attribution[] = [];
  try {
    const { data } = await db.from("audit_logs")
      .select("ts,actor_name").is("file_id", null).in("detail->>folder", [folderId, folderName])
      .in("action", [...MODIFY_ACTIONS, "trash"])
      .order("ts", { ascending: false }).limit(5);
    for (const r of ((data ?? []) as { ts?: string; actor_name?: string }[])) {
      if (r?.ts && r.actor_name) cands.push({ at: r.ts, by: r.actor_name });
    }
  } catch { /* ignore */ }
  if (childFileIds.length) {
    try {
      const { data } = await db.from("audit_logs")
        .select("ts,actor_name").in("file_id", childFileIds.slice(0, 500)).in("action", MODIFY_ACTIONS)
        .order("ts", { ascending: false }).limit(1).maybeSingle();
      const row = (data ?? null) as { ts?: string; actor_name?: string } | null;
      if (row?.ts && row.actor_name) cands.push({ at: row.ts, by: row.actor_name });
    } catch { /* ignore */ }
  }
  cands.sort((a, b) => (a.at < b.at ? 1 : -1));
  return cands[0] ?? null;
}

/**
 * Genuine Drive-side last editor (files changed outside Eiden Drive).
 * Best-effort and bounded — any failure yields null (callers fall back to
 * app-side records, never to invented data).
 */
export async function googleAttribution(googleFileId: string, driveAccountId: string): Promise<Attribution | null> {
  if (!googleFileId || !driveAccountId) return null;
  try {
    const { getAccountFresh } = await import("@/lib/drive-accounts");
    const { driveClientFor } = await import("@/lib/google-drive");
    const acct = await getAccountFresh(driveAccountId);
    if (!acct?.refresh_token) return null;
    const drive = driveClientFor(acct.refresh_token);
    if (!drive) return null;
    const get = drive.files.get({
      fileId: googleFileId,
      fields: "modifiedTime,lastModifyingUser(displayName,emailAddress)",
      supportsAllDrives: true,
    });
    const res = await Promise.race([
      get,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    const meta = (res as { data?: {
      modifiedTime?: string;
      lastModifyingUser?: { displayName?: string; emailAddress?: string };
    } } | null)?.data;
    const by = meta?.lastModifyingUser?.displayName || meta?.lastModifyingUser?.emailAddress || "";
    if (!meta?.modifiedTime || !by.trim()) return null;
    return { at: meta.modifiedTime, by: by.trim().slice(0, 80) };
  } catch {
    return null;
  }
}

/** Prefer the newest candidate (external edits beat stale app records). */
export function newest(a: Attribution | null, b: Attribution | null): Attribution | null {
  if (!a) return b;
  if (!b) return a;
  return b.at > a.at ? b : a;
}

export function hasAttributionStack(): boolean {
  return hasAdminClient();
}
