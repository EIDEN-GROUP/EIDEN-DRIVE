export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { visibleFolderIds, isManager, accessContext, folderUsable } from "@/lib/visibility";
import { parseJson } from "@/lib/http";

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supa = createClient();
  const { data, error } = await supa.from("folders").select("id,name,parent,dept,classification").order("name").limit(500);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  // Members see their department's folders: dept field OR same-named tag
  // (assigning dept "Clients" auto-unlocks everything tagged Clients).
  const rows = (data ?? []) as { id: string; name: string; parent: string | null; dept: string | null; classification: string | null }[];
  if (isManager(me.role)) return Response.json({ results: rows });
  const ctx = await accessContext(adminClient(), me);
  const vis = ctx.folders ?? visibleFolderIds(rows, me) ?? new Set<string>();
  return Response.json({ results: rows.filter((f) => vis.has(f.id)) });
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
  const { data, error } = await adminClient().from("folders")
    .insert({ name: body.name, parent: body.parent ?? null, dept, classification: "Internal" })
    .select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", req, detail: { folder: body.name } });
  return Response.json({ ok: true, id: data.id }, { status: 201 });
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
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "rename", req, detail: { folder: p.data.folder_id, from: f.name, to: p.data.name } });
  return Response.json({ ok: true });
}

const Remove = z.object({ folder_id: z.string().uuid() });

// Managers+: delete a folder, but ONLY when empty (no subfolders, no files).
// Files must be trashed individually first — never bulk-destroyed by accident.
export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Remove);
  if (p.error) return p.error;
  const db = adminClient();
  const { count: kids } = await db.from("folders").select("id", { count: "exact", head: true }).eq("parent", p.data.folder_id);
  const { count: files } = await db.from("file_index").select("id", { count: "exact", head: true }).eq("folder", p.data.folder_id);
  if ((kids ?? 0) > 0 || (files ?? 0) > 0) {
    return Response.json({ error: "folder is not empty — move or trash its contents first" }, { status: 400 });
  }
  const { data: f } = await db.from("folders").select("name").eq("id", p.data.folder_id).maybeSingle();
  if (!f) return Response.json({ error: "not found" }, { status: 404 });
  const { error } = await db.from("folders").delete().eq("id", p.data.folder_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "perm-delete", req, detail: { folder: p.data.folder_id, name: f.name } });
  return Response.json({ ok: true });
}
