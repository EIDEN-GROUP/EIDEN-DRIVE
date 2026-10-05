export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { UPLOAD_BUCKET } from "@/lib/storage";

const Q = z.object({ file_id: z.string().min(1) });

// Real download: Supabase-hosted bytes get a 5-min signed URL; Google-hosted files
// redirect to the Drive viewer (bytes stay in Google, permissions enforced there too).
export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { file_id } = Q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const supa = createClient();
  const { data: f } = await supa.from("file_index").select("id,name,storage_path,google_file_id").eq("id", file_id).single();
  if (!f) return Response.json({ error: "not found" }, { status: 404 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "download", file_id, req });
  if (f.storage_path) {
    const { data, error } = await supa.storage.from(UPLOAD_BUCKET).createSignedUrl(f.storage_path, 300);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.redirect(data.signedUrl, 302);
  }
  if (f.google_file_id) {
    return Response.redirect(`https://drive.google.com/file/d/${f.google_file_id}/view`, 302);
  }
  return Response.json({ error: "no downloadable copy yet" }, { status: 404 });
}
