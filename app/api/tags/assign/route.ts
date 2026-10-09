export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { canTouch, folderUsable, googleInScope } from "@/lib/visibility";
import { getAccounts } from "@/lib/drive-accounts";
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
    (kind === "file"
      ? db.from("file_index").select("id,name,owner,folder,google_file_id,drive_account_id").eq("id", id).maybeSingle()
      : db.from("folders").select("id,name").eq("id", id).maybeSingle())
  ]);
  if (!tag) return Response.json({ error: "tag not found" }, { status: 404 });
  if (!item) return Response.json({ error: `${kind} not found` }, { status: 404 });
  // Tags unlock: a dept tag on a file/folder grants its members access — so
  // tagging obeys the same confinement as editing. Without this, any member
  // could tag any UUID with their own department and read it (escalation).
  if (kind === "file") {
    const it = item as unknown as { id: string; owner: string; folder: string | null; google_file_id?: string | null; drive_account_id?: string | null };
    const gate = await canTouch(db, me, it);
    if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 });
    if (it.google_file_id) {
      if (!(await googleInScope(db, await getAccounts(), it.drive_account_id, it.google_file_id))) {
        return Response.json({ error: "outside this drive's shared scope" }, { status: 403 });
      }
    }
  } else {
    const dst = await folderUsable(db, me, id);
    if (!dst.ok) return Response.json({ error: dst.reason ?? "not allowed" }, { status: 403 });
  }

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
