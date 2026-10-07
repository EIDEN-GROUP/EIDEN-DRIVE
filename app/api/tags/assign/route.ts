export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { parseJson } from "@/lib/http";

const Body = z.object({
  kind: z.enum(["file", "folder"]),
  id: z.string().uuid(),
  tag_id: z.string().uuid(),
  on: z.boolean()
});

// Attach / detach one tag on one file or folder. Tagging is organisational metadata (like rename):
// any signed-in member may do it; it is audited.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const { kind, id, tag_id, on } = p.data;
  const db = adminClient();
  const [{ data: tag }, { data: item }] = await Promise.all([
    db.from("tags").select("id,name").eq("id", tag_id).maybeSingle(),
    db.from(kind === "file" ? "file_index" : "folders").select("id,name").eq("id", id).maybeSingle()
  ]);
  if (!tag) return Response.json({ error: "tag not found" }, { status: 404 });
  if (!item) return Response.json({ error: `${kind} not found` }, { status: 404 });

  const table = kind === "file" ? "file_tags" : "folder_tags";
  const col = kind === "file" ? "file_id" : "folder_id";
  const { error } = on
    ? await db.from(table).upsert({ [col]: id, tag_id }, { onConflict: `${col},tag_id`, ignoreDuplicates: true })
    : await db.from(table).delete().eq(col, id).eq("tag_id", tag_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, file_id: kind === "file" ? id : null,
    detail: { tag: (tag as { name: string }).name, [kind]: (item as { name: string }).name, tagged: on } });
  return Response.json({ ok: true });
}
