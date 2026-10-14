export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { parseJson, dbError } from "@/lib/http";

const COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const NAME = z.string().trim().min(1).max(32);

interface TagRow { id: string; name: string; color: string; created_by: string | null }

// Everything the Explorer needs in one call: all tags + direct assignments +
// COMPLETE ancestor inputs for read-time inheritance (folder parent map +
// google-folder rows). Direct file_tags stay capped at 20000 (pre-existing);
// ancestor inputs are read to completion via pagination so inherited results
// are never silently truncated by those caps.
export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = adminClient();
  const [{ data: tags, error }, { data: ft }] = await Promise.all([
    db.from("tags").select("id,name,color,created_by").order("name").limit(500),
    db.from("file_tags").select("file_id,tag_id").limit(20000),
  ]);
  const dt = await folderTagsAll(db);
  if (error) return dbError("Couldn't load tags.")(error);
  const files: Record<string, string[]> = {};
  for (const r of (ft ?? []) as { file_id: string; tag_id: string }[]) (files[r.file_id] ??= []).push(r.tag_id);
  const folders: Record<string, string[]> = {};
  for (const r of dt) (folders[r.folder_id] ??= []).push(r.tag_id);
  // Workspace ancestry (complete — folders are user-created and few).
  const folderParents: Record<string, string | null> = {};
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from("folders").select("id,parent").range(off, off + 999);
    const chunk = ((data ?? []) as { id: string; parent: string | null }[]);
    for (const f of chunk) folderParents[f.id] = f.parent;
    if (chunk.length < 1000) break;
  }
  // Google-folder rows (folder mime + pin): ancestry nodes + their direct
  // tags (fetched explicitly so the 20000 cap above can't cut an ancestor).
  const { data: gf } = await db.from("file_index")
    .select("id,google_file_id,google_parent_id,drive_account_id")
    .eq("mime", "application/vnd.google-apps.folder").limit(10000);
  const googleFolders = ((gf ?? []) as { id: string; google_file_id: string | null; google_parent_id: string | null; drive_account_id: string | null }[])
    .filter((r) => r.google_file_id)
    .map((r) => ({ id: r.id, google_id: r.google_file_id as string, parent: r.google_parent_id, account: r.drive_account_id }));
  if (googleFolders.length) {
    const ids = googleFolders.map((g) => g.id);
    for (let off = 0; off < ids.length; off += 500) {
      const { data: at } = await db.from("file_tags").select("file_id,tag_id").in("file_id", ids.slice(off, off + 500));
      for (const r of ((at ?? []) as { file_id: string; tag_id: string }[])) {
        const l = (files[r.file_id] ??= []);
        if (!l.includes(r.tag_id)) l.push(r.tag_id);
      }
    }
  }
  return Response.json({ tags: tags ?? [], files, folders, folderParents, googleFolders });
}

// folder_tags read to completion (paginated) — folder assignments are the
// inheritance supply, and a truncated supply would silently drop descendants.
async function folderTagsAll(db: ReturnType<typeof adminClient>): Promise<{ folder_id: string; tag_id: string }[]> {
  const out: { folder_id: string; tag_id: string }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from("folder_tags").select("folder_id,tag_id").range(off, off + 999);
    if (error) break;
    const chunk = ((data ?? []) as { folder_id: string; tag_id: string }[]);
    out.push(...chunk);
    if (chunk.length < 1000 || out.length >= 50000) break;
  }
  return out;
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
    return dbError("Couldn't create the tag.", `A tag called “${p.data.name}” already exists.`)(error);
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
    return dbError("Couldn't update the tag.", "Another tag already uses that name.")(error);
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
  if (error) return dbError("Couldn't delete the tag.")(error);
  await logAudit({ actor: me.id, actor_name: me.username, action: "perm-delete", req, detail: { tag: a.tag!.name } });
  return Response.json({ ok: true });
}
