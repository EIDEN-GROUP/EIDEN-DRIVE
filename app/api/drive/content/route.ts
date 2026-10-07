export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { UPLOAD_BUCKET } from "@/lib/storage";
import { driveCtxFor } from "@/lib/drive-accounts";
import { parseJson } from "@/lib/http";

// Text-file editing save path. Only plain-text formats are accepted here
// (the editor never offers Save for binary formats — see FileEditor.EDITABLE).
const Body = z.object({ file_id: z.string().uuid(), text: z.string().max(5 * 1024 * 1024) });

const TEXT_MIMES = new Set([
  "text/plain", "text/markdown", "text/html", "text/css", "text/csv",
  "application/json", "application/javascript", "application/xml", "application/x-sh"
]);
function editable(mime: string | null, name: string): boolean {
  if (!mime) return /\.(txt|md|markdown|html|htm|css|js|ts|tsx|jsx|json|xml|csv|yml|yaml|toml|sh|py|sql|env|log)$/i.test(name);
  if (TEXT_MIMES.has(mime)) return true;
  if (mime.startsWith("text/")) return true;
  return /\.(txt|md|markdown|html|htm|css|js|ts|tsx|jsx|json|xml|csv|yml|yaml|toml|sh|py|sql|env|log)$/i.test(name);
}

export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const db = adminClient();
  const { data: f } = await db.from("file_index")
    .select("id,name,mime,size,storage_path,google_file_id,drive_account_id,owner").eq("id", p.data.file_id).maybeSingle();
  if (!f) return Response.json({ error: "file not found" }, { status: 404 });
  if (f.owner !== me.id && me.role !== "admin" && me.role !== "manager") {
    return Response.json({ error: "you can only edit your own files" }, { status: 403 });
  }
  if (!editable(f.mime, f.name)) {
    return Response.json({ error: "this file type is view-only (binary formats can't be edited as text)" }, { status: 400 });
  }
  const bytes = Buffer.from(p.data.text, "utf8");
  try {
    if (f.storage_path) {
      const { error } = await db.storage.from(UPLOAD_BUCKET).update(f.storage_path, bytes, { contentType: f.mime ?? "text/plain", upsert: true });
      if (error) throw new Error(error.message);
    } else if (f.google_file_id) {
      const ctx = await driveCtxFor((f as { drive_account_id?: string | null }).drive_account_id);
      const g = ctx?.drive;
      if (!g) throw new Error("google not configured");
      await g.files.update({ fileId: f.google_file_id, supportsAllDrives: true, media: { mimeType: f.mime ?? "text/plain", body: Buffer.from(bytes) } });
    } else {
      return Response.json({ error: "no writable copy yet" }, { status: 404 });
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "save failed" }, { status: 500 });
  }
  await db.from("file_index").update({ size: bytes.length }).eq("id", f.id);
  const { data: v } = await db.from("versions").select("v").eq("file_id", f.id).order("v", { ascending: false }).limit(1).maybeSingle();
  await db.from("versions").insert({ file_id: f.id, v: ((v as { v: number } | null)?.v ?? 0) + 1, hash: "", actor: me.id });
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", file_id: f.id, req, detail: { bytes: bytes.length } });
  return Response.json({ ok: true, size: bytes.length });
}
