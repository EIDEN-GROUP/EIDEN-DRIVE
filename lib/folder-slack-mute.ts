import { adminClient, hasAdminClient } from "@/lib/supabase-admin";

// Per-folder Slack mute (migration 0024). One row = muted; unmuting deletes
// the row. Effective mute cascades to descendants at read time — Workspace via
// folders.parent, Drive via same-account google_parent_id chains — so removes,
// moves, and new subfolders stay correct with zero fan-out writes.
// ONLY the Slack fan-out is suppressed; in-app notifications and audit
// logging are never affected.

type Db = ReturnType<typeof adminClient>;

export type MuteTarget =
  | { scope: "workspace"; folderId: string }
  | { scope: "drive"; accountId: string; googleId: string };

export interface MuteDescendant {
  id: string; // workspace folder uuid, or file_index id of a google-folder row
  label: string;
  path: string;
  depth: number;
  muted: boolean;
  effectiveMuted: boolean;
  scope: "workspace" | "drive";
  accountId?: string;
  googleId?: string;
}

/** Is this exact folder explicitly muted? */
export async function isMuted(db: Db, target: MuteTarget): Promise<boolean> {
  try {
    if (target.scope === "workspace") {
      const { data } = await db.from("folder_slack_mutes").select("id")
        .eq("workspace_folder_id", target.folderId).limit(1);
      return !!data?.length;
    }
    const { data } = await db.from("folder_slack_mutes").select("id")
      .eq("drive_account_id", target.accountId).eq("google_folder_id", target.googleId).limit(1);
    return !!data?.length;
  } catch {
    return false;
  }
}

async function mutedWorkspaceSet(db: Db): Promise<Set<string>> {
  try {
    const { data } = await db.from("folder_slack_mutes").select("workspace_folder_id").not("workspace_folder_id", "is", null).limit(5000);
    return new Set(((data ?? []) as { workspace_folder_id: string }[]).map((r) => r.workspace_folder_id));
  } catch {
    return new Set();
  }
}

async function mutedDriveMap(db: Db, accountId: string): Promise<Set<string>> {
  try {
    const { data } = await db.from("folder_slack_mutes").select("google_folder_id")
      .eq("drive_account_id", accountId).limit(5000);
    return new Set(((data ?? []) as { google_folder_id: string }[]).map((r) => r.google_folder_id));
  } catch {
    return new Set();
  }
}

/**
 * Effective Slack mute for a Workspace destination folder: own row or any
 * ancestor's row. Bounded, cycle-safe.
 */
export async function workspaceEffectiveMuted(db: Db, folderId: string | null): Promise<boolean> {
  if (!folderId || !hasAdminClient()) return false;
  const muted = await mutedWorkspaceSet(db);
  if (muted.has(folderId)) return true;
  try {
    let cur: string | null = folderId;
    const seen = new Set<string>();
    for (let i = 0; i < 200 && cur && !seen.has(cur); i++) {
      seen.add(cur);
      const { data }: { data: { parent?: string | null } | null } =
        await db.from("folders").select("parent").eq("id", cur).maybeSingle();
      cur = (data ?? {}).parent ?? null;
      if (cur && muted.has(cur)) return true;
    }
  } catch { /* fail closed: unmuted */ }
  return false;
}

/**
 * Effective Slack mute for a Drive destination: own google id or any
 * same-account ancestor's row. Unindexed ancestors end the chain (fail
 * closed — they grant nothing, and mute nothing either).
 */
export async function driveEffectiveMuted(db: Db, accountId: string, googleFolderId: string | null): Promise<boolean> {
  if (!googleFolderId || !hasAdminClient()) return false;
  const muted = await mutedDriveMap(db, accountId);
  if (muted.has(googleFolderId)) return true;
  try {
    let cur: string | null = googleFolderId;
    const seen = new Set<string>();
    for (let i = 0; i < 25 && cur && !seen.has(cur); i++) {
      seen.add(cur);
      const { data }: { data: { google_parent_id?: string | null } | null } =
        await db.from("file_index").select("google_parent_id")
          .eq("google_file_id", cur).eq("drive_account_id", accountId).maybeSingle();
      cur = ((data ?? {}) as { google_parent_id?: string | null }).google_parent_id ?? null;
      if (cur && muted.has(cur)) return true;
    }
  } catch { /* fail closed */ }
  return false;
}

/**
 * Effective mute for a freshly indexed file row (post-insert): Workspace
 * folder ancestry first, then Drive ancestry. Either leg muting suppresses
 * the Slack post.
 */
export async function fileSlackMuted(db: Db, file: {
  folder: string | null; google_parent_id?: string | null; drive_account_id?: string | null;
}): Promise<boolean> {
  if (await workspaceEffectiveMuted(db, file.folder)) return true;
  if (file.google_parent_id && file.drive_account_id) {
    // The immediate parent may itself be an unindexed live folder: check the
    // exact landing parent first, then walk indexed ancestry.
    const muted = await mutedDriveMap(db, file.drive_account_id);
    if (muted.has(file.google_parent_id)) return true;
    return driveEffectiveMuted(db, file.drive_account_id, file.google_parent_id);
  }
  return false;
}

/** All descendant subfolders of a Workspace folder (bounded, cycle-safe). */
export async function workspaceDescendants(db: Db, folderId: string): Promise<{ id: string; name: string; parent: string | null }[]> {
  const { data: all } = await db.from("folders").select("id,name,parent").limit(2000);
  const rows = ((all ?? []) as { id: string; name: string; parent: string | null }[]);
  const kids = new Map<string, { id: string; name: string; parent: string | null }[]>();
  for (const f of rows) {
    if (!f.parent) continue;
    const l = kids.get(f.parent) ?? [];
    l.push(f);
    kids.set(f.parent, l);
  }
  const out: { id: string; name: string; parent: string | null }[] = [];
  const stack = [folderId];
  const seen = new Set<string>([folderId]);
  while (stack.length && out.length < 500) {
    const cur = stack.pop()!;
    for (const c of kids.get(cur) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      stack.push(c.id);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** All descendant Google subfolders under one google id (same account, bounded). */
export async function driveDescendants(db: Db, accountId: string, googleId: string): Promise<{ id: string; name: string; googleId: string; parent: string | null }[]> {
  const out: { id: string; name: string; googleId: string; parent: string | null }[] = [];
  let frontier = [googleId];
  const seen = new Set<string>(frontier);
  for (let depth = 0; depth < 25 && frontier.length && out.length < 500; depth++) {
    const { data } = await db.from("file_index").select("id,name,google_file_id,google_parent_id")
      .eq("drive_account_id", accountId).eq("mime", "application/vnd.google-apps.folder")
      .in("google_parent_id", frontier.slice(0, 500)).limit(2000);
    frontier = [];
    for (const r of ((data ?? []) as { id: string; name: string; google_file_id: string | null; google_parent_id: string | null }[])) {
      if (!r.google_file_id || seen.has(r.google_file_id)) continue;
      seen.add(r.google_file_id);
      out.push({ id: r.id, name: r.name, googleId: r.google_file_id, parent: r.google_parent_id });
      frontier.push(r.google_file_id);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
