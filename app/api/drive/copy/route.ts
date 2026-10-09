export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { UPLOAD_BUCKET } from "@/lib/storage";
import { driveCtxFor } from "@/lib/drive-accounts";
import { canTouch, folderUsable } from "@/lib/visibility";
import { parseJson } from "@/lib/http";

const Body = z.object({ file_id: z.string().uuid(), folder: z.string().uuid().nullable().optional() });

// Copy = new index row, bytes duplicated. Storage files: server-side object copy.
// Google files: drive.files.copy. The copy lands in `folder` (or the source folder).
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const db = adminClient();
  const { data: src } = await db.from("file_index")
    .select("id,name,mime,size,hash,storage_path,google_file_id,drive_account_id,backends,folder,owner").eq("id", p.data.file_id).maybeSingle();
  if (!src) return Response.json({ error: "file not found" }, { status: 404 });
  // Read the source only from your own / department space…
  const gate = await canTouch(db, me, src as { id: string; owner: string; folder: string | null });
  if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 });
  const folder = p.data.folder !== undefined ? p.data.folder : src.folder;
  // …and land the copy somewhere you're allowed to write.
  if (folder) {
    const dst = await folderUsable(db, me, folder);
    if (!dst.ok) return Response.json({ error: dst.reason ?? "not allowed" }, { status: 403 });
  }
  const copyName = `Copy of ${src.name}`;
  let storage_path: string | null = null;
  let google_file_id: string | null = null;
  const backends: string[] = [];
  try {
    if (src.storage_path) {
      storage_path = `${me.id}/${Date.now()}-copy-${src.storage_path.split("/").pop()}`;
      const { error } = await db.storage.from(UPLOAD_BUCKET).copy(src.storage_path, storage_path);
      if (error) throw new Error(error.message);
      backends.push("local");
    }
    if (src.google_file_id) {
      const ctx = await driveCtxFor((src as { drive_account_id?: string | null }).drive_account_id);
      const g = ctx?.drive;
      if (!g) throw new Error("google not configured");
      const cp = await g.files.copy({ fileId: src.google_file_id, supportsAllDrives: true, fields: "id" });
      google_file_id = cp.data.id ?? null;
      if (google_file_id) backends.push("google");
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "copy failed" }, { status: 500 });
  }
  const { data, error } = await db.from("file_index").insert({
    name: copyName, mime: src.mime, size: src.size, hash: src.hash,
    backends: backends.length ? backends : src.backends,
    owner: me.id, folder, storage_path, google_file_id,
    drive_account_id: (src as { drive_account_id?: string | null }).drive_account_id ?? null
  }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", file_id: data.id, req, detail: { copy_of: src.id } });
  return Response.json({ ok: true, id: data.id, name: copyName });
}
