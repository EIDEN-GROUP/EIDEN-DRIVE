export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { signedDownloadUrl } from "@/lib/storage";
import { parseQuery } from "@/lib/http";

const Q = z.object({ file_id: z.string().uuid() });

// Real download: Supabase-hosted bytes get a 5-min signed URL; Google-hosted files
// redirect to the Drive viewer (bytes stay in Google, permissions enforced there too).
export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = parseQuery(req, Q);
  if (p.error) return p.error;
  const { file_id } = p.data;
  const supa = createClient();
  const { data: f } = await supa.from("file_index").select("id,name,storage_path,google_file_id").eq("id", file_id).maybeSingle();
  if (!f) return Response.json({ error: "not found" }, { status: 404 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "download", file_id, req });
  if (f.storage_path) {
    try { return Response.redirect(await signedDownloadUrl(f.storage_path), 302); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : "could not sign download" }, { status: 500 }); }
  }
  if (f.google_file_id) {
    return Response.redirect(`https://drive.google.com/file/d/${f.google_file_id}/view`, 302);
  }
  return Response.json({ error: "no downloadable copy yet" }, { status: 404 });
}
