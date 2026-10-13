export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { folderUsable, isFolderBinned } from "@/lib/visibility";
import { driveCtxFor, driveGoneReason, driveBlockedResponse } from "@/lib/drive-accounts";
import { bucketFor } from "@/lib/storage";
import { parseJson } from "@/lib/http";
import { subtreeIds } from "@/lib/folders";

const Body = z.object({
  folder_id: z.string().uuid(),
  // Local workspace destination (null = top level). Drive-side copies always
  // land inside DUPLICATED Drive folders in the same account (never the
  // originals' siblings, never another account) — only the index rows join
  // the workspace destination.
  parent: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(120).optional(),
});

const GFOLDER = "application/vnd.google-apps.folder";
const MAX_FILES = 1000;

class Coded extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

interface Created {
  folderIds: string[];
  fileIds: string[];
  google: { id: string; accountId: string }[];
  storage: { bucket: string; path: string }[];
}

// Copy + paste for folders: a genuine recursive duplicate. Local folders,
// files (Storage bytes duplicated server-side), Drive files AND Drive folders
// (Google files.copy each — the API never duplicates children by itself),
// nested subfolders, file/folder tags, and version history all duplicate.
// Drive copies nest inside duplicated Drive folders (mapped parent-by-parent),
// so Drive and index agree. Approvals and bin markers never copy. Metadata
// (dept, classification) is preserved; copies are owned by the copier.
// Failures roll back everything created: no partial trees, no orphans, no
// misleading success.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const db = adminClient();
  const { data: f } = await db.from("folders").select("id,name,parent,dept,classification").eq("id", p.data.folder_id).maybeSingle();
  if (!f) return Response.json({ error: "folder not found" }, { status: 404 });
  const src = f as { id: string; name: string; parent: string | null; dept: string | null; classification: string | null };
  if (await isFolderBinned(db, src.id)) {
    return Response.json({ error: "that folder is in the Recovery Bin — restore it instead of copying it", code: "is_binned" }, { status: 409 });
  }
  const srcGate = await folderUsable(db, me, src.id);
  if (!srcGate.ok) return Response.json({ error: srcGate.reason ?? "not allowed", code: "forbidden" }, { status: 403 });
  if (p.data.parent) {
    const { data: dst } = await db.from("folders").select("id,parent").eq("id", p.data.parent).maybeSingle();
    if (!dst) return Response.json({ error: "destination folder not found", code: "dest_missing" }, { status: 404 });
    // No copying a folder into itself or its own descendants.
    const order0 = await subtreeIds(db, src.id);
    if (!order0) return Response.json({ error: "couldn't read the folder contents" }, { status: 500 });
    if (order0.includes(p.data.parent)) {
      return Response.json({ error: "can't paste a folder inside itself or its own subfolder", code: "self_descendant" }, { status: 400 });
    }
    const gate = await folderUsable(db, me, p.data.parent);
    if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed", code: "forbidden" }, { status: 403 });
  }
  const order = await subtreeIds(db, src.id);
  if (!order) return Response.json({ error: "couldn't read the folder contents" }, { status: 500 });
  for (const id of order) {
    if (id === src.id) continue;
    const gate = await folderUsable(db, me, id);
    if (!gate.ok) return Response.json({ error: `a subfolder is outside your department — copy refused`, code: "forbidden" }, { status: 403 });
  }
  // Sibling-name resolution ("Copy of X", "Copy of X (2)", …) — predictable,
  // never a silent overwrite (names aren't unique, but surprises are bad).
  const sibNames = await siblingFolderNames(db, p.data.parent);
  let name = p.data.name?.trim() || `Copy of ${src.name}`;
  if (sibNames.has(name)) {
    let n = 2;
    while (sibNames.has(`${name} (${n})`)) n++;
    name = `${name} (${n})`;
  }

  const created: Created = { folderIds: [], fileIds: [], google: [], storage: [] };
  const fail = async (error: string, code: string, status: number) => {
    await rollbackCopy(db, created);
    return Response.json({ error, code }, { status });
  };
  // Old Google folder id -> duplicated Google folder id (children re-parent
  // onto the copies, never the originals).
  const googleFolderMap = new Map<string, string>();
  try {
    // Folder rows first (parents before children: order is BFS from the root).
    const newIdOf = new Map<string, string>();
    const { data: srcRows, error: sErr } = await db.from("folders")
      .select("id,name,parent,dept,classification").in("id", order);
    if (sErr) throw new Error(sErr.message);
    const byId = new Map(((srcRows ?? []) as { id: string; name: string; parent: string | null; dept: string | null; classification: string | null }[]).map((r) => [r.id, r]));
    let rootNewId = "";
    for (const oldId of order) {
      const s = byId.get(oldId);
      if (!s) throw new Error("folder vanished mid-copy — retry");
      const newParent = oldId === src.id ? p.data.parent : newIdOf.get(s.parent ?? "") ?? null;
      if (oldId !== src.id && s.parent && !newIdOf.get(s.parent)) throw new Error("folder vanished mid-copy — retry");
      const { data: ins, error } = await db.from("folders")
        .insert({ name: oldId === src.id ? name : s.name, parent: newParent, dept: s.dept, classification: s.classification ?? "Internal", created_by: me.id })
        .select("id").single();
      if (error || !ins) throw new Error(error?.message ?? "couldn't duplicate the folders");
      const newId = (ins as { id: string }).id;
      newIdOf.set(oldId, newId);
      created.folderIds.push(newId);
      if (oldId === src.id) rootNewId = newId;
      // Folder tags duplicate with the folder.
      const { data: ftags } = await db.from("folder_tags").select("tag_id").eq("folder_id", oldId);
      for (const t of (ftags ?? []) as { tag_id: string }[]) {
        const { error: tErr } = await db.from("folder_tags").insert({ folder_id: newId, tag_id: t.tag_id });
        if (tErr) throw new Error(tErr.message);
      }
    }

    // Files, grouped by their (old) folder so each lands in the right copy.
    const files: { id: string; name: string; mime: string; size: number; hash: string | null; storage_path: string | null; storage_bucket: string | null; google_file_id: string | null; google_parent_id: string | null; drive_account_id: string | null; backends: string[]; folder: string }[] = [];
    for (let i = 0; i < order.length; i += 200) {
      const { data, error } = await db.from("file_index")
        .select("id,name,mime,size,hash,storage_path,storage_bucket,google_file_id,google_parent_id,drive_account_id,backends,folder")
        .in("folder", order.slice(i, i + 200));
      if (error) throw new Error(error.message);
      files.push(...((data ?? []) as typeof files));
    }
    if (files.length > MAX_FILES) {
      return fail(`that folder holds ${files.length} files — copy it in parts (limit ${MAX_FILES})`, "too_large", 400);
    }
    // Google folder copies must precede their children: sort Drive folders by
    // nesting depth (parents first, cycle-guarded), then all other rows.
    // Otherwise a nested file would land next to its original while the index
    // claims it lives in the copy.
    const subtreeGoogleFolders = new Set(
      files.filter((x) => x.mime === GFOLDER && x.google_file_id).map((x) => x.google_file_id as string)
    );
    const gDepth = (gid: string): number => {
      const seen = new Set<string>();
      let d = 0, cur: string | null = gid;
      while (cur && subtreeGoogleFolders.has(cur) && !seen.has(cur) && d <= files.length) {
        seen.add(cur);
        const row = files.find((x) => x.google_file_id === cur);
        cur = row?.google_parent_id ?? null;
        if (cur && subtreeGoogleFolders.has(cur)) d++;
      }
      return d;
    };
    files.sort((a, b) => {
      const af = a.mime === GFOLDER && a.google_file_id ? 0 : 1;
      const bf = b.mime === GFOLDER && b.google_file_id ? 0 : 1;
      if (af !== bf) return af - bf;
      if (af === 0) return gDepth(a.google_file_id as string) - gDepth(b.google_file_id as string);
      return 0;
    });
    for (const srcFile of files) {
      const destFolder = newIdOf.get(srcFile.folder);
      if (!destFolder) throw new Error("folder vanished mid-copy — retry");
      let storage_path: string | null = null;
      let storage_bucket: string | null = srcFile.storage_bucket;
      let google_file_id: string | null = null;
      let google_parent_id: string | null = null;
      const backends: string[] = [];
      if (srcFile.storage_path) {
        storage_path = `${me.id}/${Date.now()}-copy-${srcFile.storage_path.split("/").pop()}`;
        const { error } = await db.storage.from(bucketFor(srcFile)).copy(srcFile.storage_path, storage_path);
        if (error) throw new Error(error.message);
        created.storage.push({ bucket: bucketFor(srcFile), path: storage_path });
        backends.push("local");
      }
      if (srcFile.google_file_id) {
        const block = await driveGoneReason(srcFile.drive_account_id);
        if (block) throw new Coded(block.error, block.status);
        const ctx = await driveCtxFor(srcFile.drive_account_id);
        if (!ctx?.drive) throw new Coded("chosen drive is disabled — re-enable it in Storage or pick another drive", 410);
        // Google folders duplicate as folders; their children re-parent onto
        // the copy (mapped below) — never onto the original.
        const isGFolder = srcFile.mime === GFOLDER;
        // Mapped (duplicated) parent wins; otherwise the copy lands next to
        // its original — never parentless (Drive root) by accident.
        const wantParent = (srcFile.google_parent_id && googleFolderMap.get(srcFile.google_parent_id)) ?? srcFile.google_parent_id;
        const cp = await ctx.drive.files.copy({
          fileId: srcFile.google_file_id, supportsAllDrives: true, fields: "id",
          ...(wantParent ? { requestBody: { parents: [wantParent] } } : {}),
        });
        google_file_id = cp.data.id ?? null;
        if (!google_file_id || google_file_id === srcFile.google_file_id) throw new Error("Google didn't return a separate copy");
        created.google.push({ id: google_file_id, accountId: srcFile.drive_account_id as string });
        backends.push("google");
        if (isGFolder) {
          googleFolderMap.set(srcFile.google_file_id, google_file_id);
          google_parent_id = wantParent ?? srcFile.google_parent_id;
        } else {
          google_parent_id = wantParent ?? srcFile.google_parent_id;
        }
      }
      const { data: ins, error } = await db.from("file_index").insert({
        name: srcFile.name, mime: srcFile.mime, size: srcFile.size, hash: srcFile.hash,
        backends: backends.length ? backends : srcFile.backends,
        owner: me.id, folder: destFolder, storage_path, storage_bucket: storage_path ? storage_bucket : null,
        google_file_id, google_parent_id, drive_account_id: srcFile.drive_account_id,
      }).select("id").single();
      if (error || !ins) throw new Error(error?.message ?? "couldn't duplicate the files");
      const newFileId = (ins as { id: string }).id;
      created.fileIds.push(newFileId);
      // Tags + version history duplicate; approvals and bin markers never do.
      const { data: ftags } = await db.from("file_tags").select("tag_id").eq("file_id", srcFile.id);
      for (const t of (ftags ?? []) as { tag_id: string }[]) {
        const { error: tErr } = await db.from("file_tags").insert({ file_id: newFileId, tag_id: t.tag_id });
        if (tErr) throw new Error(tErr.message);
      }
      const { data: vers } = await db.from("versions").select("v,hash,actor").eq("file_id", srcFile.id).order("v");
      for (const v of (vers ?? []) as { v: number; hash: string; actor: string }[]) {
        const { error: vErr } = await db.from("versions").insert({ file_id: newFileId, v: v.v, hash: v.hash, actor: v.actor });
        if (vErr) throw new Error(vErr.message);
      }
    }
    await logAudit({ actor: me.id, actor_name: me.username, action: "add", req, detail: { folder_copy_of: src.id, folder: rootNewId, name, folders: created.folderIds.length, files: created.fileIds.length } });
    return Response.json({ ok: true, id: rootNewId, name, folders: created.folderIds.length, files: created.fileIds.length });
  } catch (e) {
    if (e instanceof Coded) {
      await rollbackCopy(db, created);
      return driveBlockedResponse({ error: e.message, code: "drive_disabled", status: e.status as 410 });
    }
    return fail(e instanceof Error ? e.message : "copy failed", "copy_failed", 502);
  }
}

async function siblingFolderNames(db: { from(t: string): any }, parent: string | null): Promise<Set<string>> {
  const q = db.from("folders").select("name");
  const { data } = parent ? await q.eq("parent", parent) : await q.is("parent", null);
  return new Set(((data ?? []) as { name: string }[]).map((r) => r.name));
}

// Best-effort reverse-order teardown. Failures warn server-side; the API
// answer stays honest about the copy that didn't happen.
async function rollbackCopy(db: { from(t: string): any; storage: { from(b: string): { remove(p: string[]): Promise<{ error: { message: string } | null }> } } }, created: Created) {
  for (const id of created.fileIds.reverse()) {
    try { await db.from("file_index").delete().eq("id", id); } catch { /* ignore */ }
  }
  for (const id of created.folderIds.reverse()) {
    try { await db.from("folders").delete().eq("id", id); } catch { /* ignore */ }
  }
  for (const s of created.storage) {
    try { await db.storage.from(s.bucket).remove([s.path]); }
    catch (e) { console.warn(`[folder-copy-rollback] storage ${s.path}: ${e instanceof Error ? e.message : e}`); }
  }
  for (const gg of created.google) {
    try {
      const ctx = await driveCtxFor(gg.accountId);
      if (ctx?.drive) await ctx.drive.files.delete({ fileId: gg.id, supportsAllDrives: true });
    } catch (e) { console.warn(`[folder-copy-rollback] drive ${gg.id}: ${e instanceof Error ? e.message : e}`); }
  }
}
