export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { canTouch, folderUsable, googleInScope, googlePinOf } from "@/lib/visibility";
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
      ? db.from("file_index").select("id,name,owner,folder,google_file_id,google_parent_id,drive_account_id").eq("id", id).maybeSingle()
      : db.from("folders").select("id,name").eq("id", id).maybeSingle())
  ]);
  if (!tag) return Response.json({ error: "tag not found" }, { status: 404 });
  if (!item) return Response.json({ error: `${kind} not found` }, { status: 404 });
  // Tags unlock: a dept tag on a file/folder grants its members access — so
  // tagging obeys the same confinement as editing. Without this, any member
  // could tag any UUID with their own department and read it (escalation).
  if (kind === "file") {
    const it = item as unknown as { id: string; owner: string; folder: string | null; google_file_id?: string | null; drive_account_id?: string | null };
    const gate = await canTouch(db, me, it, googlePinOf(it));
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
  // Folder tags inherit to every descendant at read time — report the scope
  // so the UI can confirm it (bounded, best-effort; never fails the request).
  const affected = await descendantImpact(db, kind, id, item).catch(() => null);
  return Response.json({ ok: true, ...(affected ? { affected } : {}) });
}

// How many folders/files inherit from this item (caps keep it cheap on huge
// trees; counts are exact head-counts, not fetched rows).
async function descendantImpact(
  db: ReturnType<typeof adminClient>, kind: "file" | "folder", id: string, item: unknown
): Promise<{ folders: number; files: number } | null> {
  if (kind === "folder") {
    const { data: all } = await db.from("folders").select("id,parent").limit(2000);
    const rows = ((all ?? []) as { id: string; parent: string | null }[]);
    const kids = new Map<string, string[]>();
    for (const f of rows) {
      if (!f.parent) continue;
      const l = kids.get(f.parent) ?? [];
      l.push(f.id);
      kids.set(f.parent, l);
    }
    const under = new Set<string>();
    const stack = [id];
    while (stack.length && under.size < 2000) {
      const cur = stack.pop()!;
      for (const c of kids.get(cur) ?? []) {
        if (c !== id && !under.has(c)) { under.add(c); stack.push(c); }
      }
    }
    let files = 0;
    const scope = [...under];
    for (let off = 0; off < scope.length; off += 500) {
      const { count } = await db.from("file_index").select("id", { count: "exact", head: true }).in("folder", scope.slice(off, off + 500));
      files += count ?? 0;
    }
    if (!under.size && !files) return null;
    return { folders: under.size, files };
  }
  const row = item as { google_file_id?: string | null; drive_account_id?: string | null };
  if (!row.google_file_id) return null;
  // Google-folder row: walk the indexed same-account subtree (visited set
  // breaks cycles; node cap bounds huge drives).
  let folders = 0, files = 0;
  let frontier = [row.google_file_id];
  const seen = new Set<string>(frontier);
  for (let depth = 0; depth < 25 && frontier.length && folders + files < 2000; depth++) {
    let q = db.from("file_index").select("google_file_id,mime").in("google_parent_id", frontier.slice(0, 500));
    if (row.drive_account_id) q = q.eq("drive_account_id", row.drive_account_id);
    const { data } = await q.limit(2000);
    frontier = [];
    for (const r of ((data ?? []) as { google_file_id: string | null; mime: string | null }[])) {
      if (!r.google_file_id || seen.has(r.google_file_id)) continue;
      seen.add(r.google_file_id);
      if (r.mime === "application/vnd.google-apps.folder") folders++;
      else files++;
      frontier.push(r.google_file_id);
    }
  }
  if (!folders && !files) return null;
  return { folders, files };
}
