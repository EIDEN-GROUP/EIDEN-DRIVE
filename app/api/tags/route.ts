export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { parseJson } from "@/lib/http";

const COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const NAME = z.string().trim().min(1).max(32);

interface TagRow { id: string; name: string; color: string; created_by: string | null }

// Everything the Explorer needs in one call: all tags + which files/folders carry which tags.
export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = adminClient();
  const [{ data: tags, error }, { data: ft }, { data: dt }] = await Promise.all([
    db.from("tags").select("id,name,color,created_by").order("name").limit(500),
    db.from("file_tags").select("file_id,tag_id").limit(20000),
    db.from("folder_tags").select("folder_id,tag_id").limit(5000)
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const files: Record<string, string[]> = {};
  for (const r of (ft ?? []) as { file_id: string; tag_id: string }[]) (files[r.file_id] ??= []).push(r.tag_id);
  const folders: Record<string, string[]> = {};
  for (const r of (dt ?? []) as { folder_id: string; tag_id: string }[]) (folders[r.folder_id] ??= []).push(r.tag_id);
  return Response.json({ tags: tags ?? [], files, folders });
}

// Any signed-in member can create a tag (like Finder tags); names are unique, case-insensitively.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, z.object({ name: NAME, color: COLOR.default("#5b3fd0") }));
  if (p.error) return p.error;
  const db = adminClient();
  const { data, error } = await db.from("tags").insert({ name: p.data.name, color: p.data.color, created_by: me.id }).select("id,name,color,created_by").single();
  if (error) {
    const dup = /duplicate|unique/i.test(error.message);
    return Response.json({ error: dup ? `A tag called “${p.data.name}” already exists.` : error.message }, { status: dup ? 409 : 500 });
  }
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", req, detail: { tag: p.data.name } });
  return Response.json({ ok: true, tag: data }, { status: 201 });
}

async function authorize(id: string, me: { id: string; role: "admin" | "manager" | "member" }) {
  const db = adminClient();
  const { data: t } = await db.from("tags").select("id,name,created_by").eq("id", id).maybeSingle();
  if (!t) return { error: Response.json({ error: "tag not found" }, { status: 404 }) };
  const row = t as TagRow;
  if (row.created_by !== me.id && !can(me.role, "manage-users")) {
    return { error: Response.json({ error: "only the creator or a manager can change this tag" }, { status: 403 }) };
  }
  return { tag: row };
}

export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, z.object({ id: z.string().uuid(), name: NAME.optional(), color: COLOR.optional() }).refine((v) => v.name || v.color, { message: "nothing to update" }));
  if (p.error) return p.error;
  const a = await authorize(p.data.id, me);
  if (a.error) return a.error;
  const patch: Record<string, string> = {};
  if (p.data.name) patch.name = p.data.name;
  if (p.data.color) patch.color = p.data.color;
  const { error } = await adminClient().from("tags").update(patch).eq("id", p.data.id);
  if (error) {
    const dup = /duplicate|unique/i.test(error.message);
    return Response.json({ error: dup ? "Another tag already uses that name." : error.message }, { status: dup ? 409 : 500 });
  }
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { tag: a.tag!.name, ...patch } });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, z.object({ id: z.string().uuid() }));
  if (p.error) return p.error;
  const a = await authorize(p.data.id, me);
  if (a.error) return a.error;
  const { error } = await adminClient().from("tags").delete().eq("id", p.data.id); // join rows cascade
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "perm-delete", req, detail: { tag: a.tag!.name } });
  return Response.json({ ok: true });
}
