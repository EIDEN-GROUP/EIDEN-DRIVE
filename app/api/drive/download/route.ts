export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { signedDownloadUrl, UPLOAD_BUCKET } from "@/lib/storage";
import { driveClient } from "@/lib/google-drive";
import { parseQuery } from "@/lib/http";

const Q = z.object({ file_id: z.string().uuid(), raw: z.string().optional(), json: z.string().optional() });

const RAW_MAX = 25 * 1024 * 1024; // in-app preview cap — bigger files use Download

// Real download: Supabase-hosted bytes get a 5-min signed URL; Google-hosted files
// redirect to the Drive viewer (bytes stay in Google, permissions enforced there too).
// ?json=1 → { url } instead of redirect (viewer embedding). ?raw=1 → bytes streamed
// through the server (needed for in-app preview of Google files + text extraction).
export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = parseQuery(req, Q);
  if (p.error) return p.error;
  const { file_id } = p.data;
  const supa = createClient();
  const { data: f } = await supa.from("file_index").select("id,name,mime,size,storage_path,google_file_id").eq("id", file_id).maybeSingle();
  if (!f) return Response.json({ error: "not found" }, { status: 404 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "download", file_id, req });
  if (p.data.json) {
    if (f.storage_path) {
      try { return Response.json({ url: await signedDownloadUrl(f.storage_path), mime: f.mime }); }
      catch (e) { return Response.json({ error: e instanceof Error ? e.message : "could not sign download" }, { status: 500 }); }
    }
    // No direct-embed URL exists for Google files (Drive blocks framing) —
    // the viewer uses ?raw=1 for those instead.
    return Response.json({ error: "use raw=1 for Google-hosted previews", google_file: true }, { status: 400 });
  }
  if (p.data.raw) {
    if (typeof f.size === "number" && f.size > RAW_MAX) {
      return Response.json({ error: "file too large to preview — use Download", too_large: true }, { status: 400 });
    }
    try {
      if (f.storage_path) {
        const db = adminClient();
        const { data: blob, error } = await db.storage.from(UPLOAD_BUCKET).download(f.storage_path);
        if (error || !blob) throw new Error(error?.message ?? "storage read failed");
        return new Response(blob, { headers: { "content-type": f.mime ?? "application/octet-stream", "content-disposition": `inline; filename="${encodeURIComponent(f.name)}"` } });
      }
      if (f.google_file_id) {
        const g = driveClient();
        if (!g) throw new Error("google not configured");
        const meta = await g.files.get({ fileId: f.google_file_id, fields: "size,mimeType", supportsAllDrives: true });
        if (Number(meta.data.size ?? 0) > RAW_MAX) {
          return Response.json({ error: "file too large to preview — use Download", too_large: true }, { status: 400 });
        }
        const dl = await g.files.get({ fileId: f.google_file_id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
        return new Response(Buffer.from(dl.data as ArrayBuffer), {
          headers: { "content-type": f.mime ?? (meta.data.mimeType as string) ?? "application/octet-stream", "content-disposition": `inline; filename="${encodeURIComponent(f.name)}"` }
        });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "preview failed";
      if (/not.?found|404/i.test(m)) return Response.json({ error: "Google copy missing — the Drive file was deleted or unshared", gone: true }, { status: 404 });
      return Response.json({ error: m }, { status: 500 });
    }
  }
  if (f.storage_path) {
    try { return Response.redirect(await signedDownloadUrl(f.storage_path), 302); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : "could not sign download" }, { status: 500 }); }
  }
  if (f.google_file_id) {
    return Response.redirect(`https://drive.google.com/file/d/${f.google_file_id}/view`, 302);
  }
  return Response.json({ error: "no downloadable copy yet" }, { status: 404 });
}
