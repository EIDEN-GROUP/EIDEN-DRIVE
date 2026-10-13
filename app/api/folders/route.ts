export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { visibleFolderIds, isManager, accessContext, folderUsable, binnedFolderIds } from "@/lib/visibility";
import { parseJson, dbError } from "@/lib/http";
import { usernamesFor } from "@/lib/people";
import { trashDriveFile } from "@/lib/google-drive";
import { googleErrorMessage } from "@/lib/errors";
import { driveCtxFor, driveGoneReason, driveBlockedResponse } from "@/lib/drive-accounts";

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supa = createClient();
  // created_at/created_by arrive with 0018 — fall back to the old shape until it is applied.
  const pull = (cols: string) => supa.from("folders").select(cols).order("name").limit(500);
  let { data, error } = await pull("id,name,parent,dept,classification,created_at,created_by");
  if (error && /created_(at|by)/.test(error.message)) ({ data, error } = await pull("id,name,parent,dept,classification"));
  if (error) return dbError("Couldn't load folders.")(error);
  // Members see their department's folders: dept field OR same-named tag
  // (assigning dept "Clients" auto-unlocks everything tagged Clients).
  // In department-tag mode (matching tag actually assigned) this narrows to
  // only department folders + their subtrees, with fallback to all-by-default.
  type FolderRow = { id: string; name: string; parent: string | null; dept: string | null; classification: string | null; created_at?: string | null; created_by?: string | null };
  let rows = (data ?? []) as unknown as FolderRow[];
  if (!isManager(me.role)) {
    const ctx = await accessContext(adminClient(), me);
    const vis = ctx.folders ?? visibleFolderIds(rows, me) ?? new Set<string>();
    rows = rows.filter((f) => vis.has(f.id));
  }
  // Binned folders never list (they restore as a unit from the Recovery Bin).
  if (rows.length) {
    const binned = await binnedFolderIds(adminClient(), rows.map((f) => f.id));
    if (binned.size) rows = rows.filter((f) => !binned.has(f.id));
  }
  const names = await usernamesFor(rows.map((r) => r.created_by));
  return Response.json({ results: rows.map((r) => ({ ...r, created_by_name: r.created_by ? names.get(r.created_by) ?? null : null })) });
}

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  parent: z.string().uuid().nullable().optional(),
  dept: z.string().max(60).nullable().optional()
});

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const body = p.data;
  const supa = createClient();
  // Only managers may choose a department tag explicitly; members inherit their own.
  // Write via service role after the checks (folders_insert RLS is a backstop, not the gate).
  const dept = me.role === "member" ? me.department_tag : body.dept ?? me.department_tag;
  const db = adminClient();
  // A folder can only be born where you may write: no nesting under another
  // department's folder, no orphaning under a nonexistent id.
  if (body.parent) {
    const dst = await folderUsable(db, me, body.parent);
    if (!dst.ok) return Response.json({ error: dst.reason ?? "not allowed" }, { status: 403 });
  }
  const base = { name: body.name, parent: body.parent ?? null, dept, classification: "Internal" };
  let { data, error } = await db.from("folders").insert({ ...base, created_by: me.id }).select("id").single();
  // Pre-0018 schema has no created_by column: insert without it.
  if (error && /created_by/.test(error.message)) ({ data, error } = await db.from("folders").insert(base).select("id").single());
  if (error) return dbError("Couldn't create the folder.")(error);
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", req, detail: { folder: body.name } });
  return Response.json({ ok: true, id: data!.id }, { status: 201 });
}

const Rename = z.object({
  folder_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120)
});

// Rename a folder you can see (own/dept/tag space, or manager). Renaming
// someone else's department folder is not an innocent edit.
export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Rename);
  if (p.error) return p.error;
  const db = adminClient();
  const gate = await folderUsable(db, me, p.data.folder_id);
  if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 });
  const { data: f } = await db.from("folders").select("id,name").eq("id", p.data.folder_id).maybeSingle();
  if (!f) return Response.json({ error: "not found" }, { status: 404 });
  const { error } = await db.from("folders").update({ name: p.data.name }).eq("id", p.data.folder_id);
  if (error) return dbError("Couldn't rename the folder.")(error);
  await logAudit({ actor: me.id, actor_name: me.username, action: "rename", req, detail: { folder: p.data.folder_id, from: f.name, to: p.data.name } });
  return Response.json({ ok: true });
}

const Remove = z.object({ folder_id: z.string().uuid(), purge: z.boolean().optional() });

// Trash a folder with everything inside it, the way Drive does (any
// authenticated user with write access to the whole subtree; managers bypass
// per-folder checks). Files AND folders are never destroyed here — folder
// rows are kept with folder_bin markers and every live file goes to the
// Recovery Bin (90 days), so the subtree restores as a unit with hierarchy,
// parents, and metadata intact. Nothing is re-homed.
//
// purge:true (managers/admins only, folder must already be binned) destroys:
// every binned file via the file purge path, then the folder rows deepest
// first. Two-step like files: trash first, purge second.
export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Remove);
  if (p.error) return p.error;
  if (p.data.purge && !can(me.role, "perm-delete")) {
    return Response.json({ error: "managers and admins only", code: "forbidden" }, { status: 403 });
  }
  const db = adminClient();
  const { data: f } = await db.from("folders").select("id,name,parent").eq("id", p.data.folder_id).maybeSingle();
  if (!f) return Response.json({ error: "not found" }, { status: 404 });

  // Subtree, breadth-first; reversed later so children go before parents.
  // Seen-set keeps this linear and cycle-safe (a corrupt parent cycle can't
  // loop forever); frontier reads are chunked so giant trees can't blow URL limits.
  const order: string[] = [f.id];
  const seen = new Set<string>(order);
  for (let i = 0, frontier = [f.id]; frontier.length && i < 50; i++) {
    const next: string[] = [];
    for (let j = 0; j < frontier.length; j += 200) {
      const { data: kids, error } = await db.from("folders").select("id").in("parent", frontier.slice(j, j + 200));
      if (error) return dbError("Couldn't read the folder contents.")(error);
      for (const k of (kids ?? []) as { id: string }[]) {
        if (!seen.has(k.id)) { seen.add(k.id); next.push(k.id); }
      }
    }
    frontier = next;
    order.push(...frontier);
  }

  // Trash-vs-purge routing. Purge destroys a BINNED subtree (two-step, like
  // files); trashing an already-binned folder — or purging a live one — is a
  // 409 with guidance, never a silent no-op. (Missing folder_bin table =
  // migration 0020 not applied: folder trash/purge refuse loudly.)
  const { data: alreadyBinned, error: binErr } = await db.from("folder_bin").select("folder_id").eq("folder_id", f.id).maybeSingle();
  if (binErr && /does not exist|could not find|schema cache/i.test(binErr.message)) {
    return Response.json({ error: "folder trash isn't set up yet — apply migration 0020", code: "migration_missing" }, { status: 500 });
  }
  if (p.data.purge) {
    if (!alreadyBinned) {
      return Response.json({ error: "trash the folder first — purge only destroys binned folders", code: "not_binned" }, { status: 409 });
    }
    return purgeFolderTree(req, me.id, me.username, f as { id: string; name: string }, order);
  }
  if (alreadyBinned) {
    return Response.json({ error: "folder is already in the Recovery Bin", code: "already_binned" }, { status: 409 });
  }

  // Trash-path authorization: EVERY folder in the subtree must be writable —
  // trashing a tree that nests another department's folder is refused up
  // front, before a single bin row is written. (Managers bypass per-folder.)
  for (const id of order) {
    const dst = await folderUsable(db, me, id);
    if (!dst.ok) return Response.json({ error: dst.reason ?? "not allowed", code: "forbidden" }, { status: 403 });
  }

  const files: { id: string; google_file_id: string | null; drive_account_id: string | null }[] = [];
  for (let i = 0; i < order.length; i += 200) {
    const { data, error } = await db.from("file_index").select("id,google_file_id,drive_account_id").in("folder", order.slice(i, i + 200));
    if (error) return dbError("Couldn't read the folder contents.")(error);
    files.push(...((data ?? []) as typeof files));
  }
  const binned = new Set<string>();
  for (let i = 0; i < files.length; i += 200) {
    const { data } = await db.from("recovery_bin").select("file_id").in("file_id", files.slice(i, i + 200).map((x) => x.id));
    for (const b of data ?? []) binned.add((b as { file_id: string }).file_id);
  }
  const live = files.filter((x) => !binned.has(x.id));

  // Folder markers FIRST (upsert = retry-safe): if anything below fails, a
  // retry resumes instead of duplicating.
  for (let i = 0; i < order.length; i += 200) {
    const { error } = await db.from("folder_bin").upsert(order.slice(i, i + 200).map((folder_id) => ({ folder_id, deleted_by: me.id })));
    if (error) return dbError("Couldn't move the folders to the Recovery Bin.")(error);
  }

  // Bin each live file (DB first, then Google — same order as /api/drive/trash).
  // Fail closed per file: a dead/legacy drive refuses with a coded error
  // (rolling back that file's bin row) instead of env-token trashing.
  // NOTE: folder_bin rows above stay on a per-file abort — the tree is still
  // consistently "binned", and retry finishes the remaining files.
  for (const x of live) {
    const { error } = await db.from("recovery_bin").upsert({ file_id: x.id, deleted_by: me.id });
    if (error) return dbError("Couldn't move the folder's files to the Recovery Bin.")(error);
    if (x.google_file_id) {
      const block = await driveGoneReason(x.drive_account_id);
      if (block) {
        await db.from("recovery_bin").delete().eq("file_id", x.id);
        return driveBlockedResponse(block);
      }
      try {
        const ctx = await driveCtxFor(x.drive_account_id);
        if (!ctx?.drive) {
          await db.from("recovery_bin").delete().eq("file_id", x.id);
          return driveBlockedResponse({ error: "chosen drive is disabled — re-enable it in Storage or pick another drive", code: "drive_disabled", status: 410 });
        }
        await trashDriveFile(x.google_file_id, ctx.drive);
      } catch (e) {
        await db.from("recovery_bin").delete().eq("file_id", x.id);
        return Response.json({ error: `${googleErrorMessage(e instanceof Error ? e.message : "google trash failed")} — nothing was deleted, safe to retry`, code: "google_failed" }, { status: 502 });
      }
    }
  }

  await logAudit({ actor: me.id, actor_name: me.username, action: "trash", req, detail: { folder: f.id, name: (f as { name: string }).name, subfolders: order.length - 1, binned: live.length } });
  return Response.json({ ok: true, folders: order.length, binned: live.length });
}

// Permanent destroy of a BINNED folder subtree (managers/admins only).
// Every still-binned file goes through the file purge path (Google bytes,
// Storage bytes, history detach, row delete); files restored individually
// since binning are skipped and counted, never force-purged. Folder rows go
// last, deepest first. Any step failing aborts with what was/wasn't done.
async function purgeFolderTree(
  req: Request, meId: string, meName: string,
  f: { id: string; name: string }, order: string[]
) {
  const db = adminClient();
  const { deleteDriveFile } = await import("@/lib/google-drive");
  const { bucketFor } = await import("@/lib/storage");
  const gone = (m: string) => /not.?found|404|no such/i.test(m);
  const files: { id: string; name: string; size: number; hash: string | null; storage_path: string | null; storage_bucket: string | null; google_file_id: string | null; drive_account_id: string | null }[] = [];
  for (let i = 0; i < order.length; i += 200) {
    const { data, error } = await db.from("file_index").select("id,name,size,hash,storage_path,storage_bucket,google_file_id,drive_account_id").in("folder", order.slice(i, i + 200));
    if (error) return dbError("Couldn't read the folder contents.")(error);
    files.push(...((data ?? []) as typeof files));
  }
  const { data: binnedRows } = await db.from("recovery_bin").select("file_id").in("file_id", files.map((x) => x.id));
  const binned = new Set(((binnedRows ?? []) as { file_id: string }[]).map((b) => b.file_id));
  let purged = 0, skippedLive = 0;
  for (const x of files) {
    if (!binned.has(x.id)) { skippedLive++; continue; }
    if (x.google_file_id) {
      const block = await driveGoneReason(x.drive_account_id);
      if (block) return driveBlockedResponse(block);
      const ctx = await driveCtxFor(x.drive_account_id);
      if (!ctx?.drive) return driveBlockedResponse({ error: "Can't reach the Google account — reconnect it, then try again (nothing was deleted).", code: "drive_disabled", status: 410 });
      try { await deleteDriveFile(String(x.google_file_id), ctx.drive); }
      catch (e) {
        const m = e instanceof Error ? e.message : "unknown";
        if (!gone(m)) return Response.json({ error: `Google delete failed: ${m} (nothing else was deleted — safe to retry)`, code: "google_failed" }, { status: 502 });
      }
    }
    if (x.storage_path) {
      const { error } = await db.storage.from(bucketFor(x)).remove([x.storage_path]);
      if (error && !gone(error.message)) return Response.json({ error: `Storage delete failed: ${error.message} (safe to retry)`, code: "storage_failed" }, { status: 502 });
    }
    await db.from("approvals").delete().eq("file_id", x.id);
    await db.from("audit_logs").update({ file_id: null }).eq("file_id", x.id);
    await db.from("recovery_bin").delete().eq("file_id", x.id);
    const { error } = await db.from("file_index").delete().eq("id", x.id);
    if (error) return Response.json({ error: `Bytes were erased but the index row could not be removed: ${error.message}`, code: "index_failed" }, { status: 500 });
    purged++;
  }
  for (let i = 0; i < order.length; i += 200) {
    const { error } = await db.from("folder_bin").delete().in("folder_id", order.slice(i, i + 200));
    if (error) return dbError("Couldn't clear the folder markers.")(error);
  }
  for (const id of [...order].reverse()) {
    const { error } = await db.from("folders").delete().eq("id", id);
    if (error) return dbError("Couldn't remove the folders.")(error);
  }
  await logAudit({ actor: meId, actor_name: meName, action: "perm-delete", req, detail: { folder: f.id, name: f.name, subfolders: order.length - 1, purged, skipped_live: skippedLive } });
  return Response.json({ ok: true, folders: order.length, purged, skipped_live: skippedLive });
}
