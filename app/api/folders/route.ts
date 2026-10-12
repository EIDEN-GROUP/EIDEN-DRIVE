export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { visibleFolderIds, isManager, accessContext, folderUsable } from "@/lib/visibility";
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

const Remove = z.object({ folder_id: z.string().uuid() });

// Managers+: delete a folder with everything inside it, the way Drive does.
// Files are never destroyed here — every live file in the subtree goes to the
// Recovery Bin (90 days) and is re-homed to the deleted folder's parent so a
// restore lands somewhere that still exists. Then the folders are removed,
// deepest first (folders.parent / file_index.folder have no cascade).
export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Remove);
  if (p.error) return p.error;
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

  // Bin each live file (DB first, then Google — same order as /api/drive/trash).
  // Fail closed per file: a dead/legacy drive refuses with a coded error
  // (rolling back that file's bin row) instead of env-token trashing.
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

  // Re-home every file (binned or not) out of the doomed subtree.
  for (let i = 0; i < files.length; i += 200) {
    const { error } = await db.from("file_index").update({ folder: f.parent ?? null }).in("id", files.slice(i, i + 200).map((x) => x.id));
    if (error) return dbError("Couldn't move the folder's files.")(error);
  }
  for (const id of [...order].reverse()) {
    const { error } = await db.from("folders").delete().eq("id", id);
    if (error) return dbError("Couldn't remove the folders.")(error);
  }
  await logAudit({ actor: me.id, actor_name: me.username, action: "perm-delete", req, detail: { folder: f.id, name: f.name, subfolders: order.length - 1, binned: live.length } });
  return Response.json({ ok: true, folders: order.length, binned: live.length });
}
