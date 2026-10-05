import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { restoreDriveFile } from "@/lib/google-drive";
import { logAudit } from "@/lib/audit";
import { getProfile, can } from "@/lib/roles";

const Body = z.object({ file_id: z.string().min(1) });

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "restore")) return Response.json({ error: "managers only" }, { status: 403 });
  const { file_id } = Body.parse(await req.json());
  const supa = createClient();
  const { data: f } = await supa.from("file_index").select("google_file_id").eq("id", file_id).single();
  if (f?.google_file_id) await restoreDriveFile(String(f.google_file_id));
  await supa.from("recovery_bin").delete().eq("file_id", file_id);
  await logAudit({ actor: me.id, actor_name: me.username, action: "restore", file_id, req });
  return Response.json({ ok: true });
}
