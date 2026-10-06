export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { restoreDriveFile } from "@/lib/google-drive";
import { logAudit } from "@/lib/audit";
import { getProfile, can } from "@/lib/roles";
import { parseJson } from "@/lib/http";

const Body = z.object({ file_id: z.string().uuid() });

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "restore")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const { file_id } = p.data;
  const supa = createClient();
  const { data: f } = await supa.from("file_index").select("google_file_id").eq("id", file_id).maybeSingle();
  if (f?.google_file_id) {
    try { await restoreDriveFile(String(f.google_file_id)); }
    catch (e) { return Response.json({ error: `Google restore failed: ${e instanceof Error ? e.message : "unknown"}` }, { status: 502 }); }
  }
  const { error } = await supa.from("recovery_bin").delete().eq("file_id", file_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "restore", file_id, req });
  return Response.json({ ok: true });
}
