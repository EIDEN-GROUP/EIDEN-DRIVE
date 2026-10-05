export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { getProfile } from "@/lib/roles";

// Metadata-only upload endpoint (bytes go direct to Google via signed flow in P2).
// Agent USB→Google jobs land here to create file_index + version + audit.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json() as { name: string; mime?: string; size?: number; hash?: string; backends?: string[]; folder?: string };
  if (!body.name) return Response.json({ error: "name required" }, { status: 400 });
  const supa = createClient();
  const { data, error } = await supa.from("file_index").insert({
    name: body.name, mime: body.mime ?? "application/octet-stream", size: body.size ?? 0,
    hash: body.hash ?? null, backends: body.backends ?? ["google"], owner: me.id, folder: body.folder ?? null
  }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await supa.from("versions").insert({ file_id: data.id, v: 1, hash: body.hash ?? "", actor: me.id });
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", file_id: data.id, req, detail: { backends: body.backends } });
  return Response.json({ ok: true, id: data.id });
}
