export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const supa = createClient();
  const { data, error } = await supa.from("folders").select("id,name,parent,dept,classification").order("name").limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ results: data ?? [] });
}

const Body = z.object({
  name: z.string().min(1).max(120),
  parent: z.string().uuid().nullable().optional(),
  dept: z.string().max(60).nullable().optional()
});

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = Body.parse(await req.json());
  const supa = createClient();
  const { data, error } = await supa.from("folders")
    .insert({ name: body.name.trim(), parent: body.parent ?? null, dept: body.dept ?? me.department_tag, classification: "Internal" })
    .select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", req, detail: { folder: body.name } });
  return Response.json({ ok: true, id: data.id }, { status: 201 });
}
