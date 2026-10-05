export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";

const Update = z.object({ user_id: z.string().uuid(), department_tag: z.string().max(60).nullable(), role: z.enum(["admin", "manager", "member"]).optional() });

// Manager/Admin only: assign dept tag + role. Members can never self-assign.
export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "assign-tag")) return Response.json({ error: "managers only" }, { status: 403 });
  const { user_id, department_tag, role } = Update.parse(await req.json());
  const supa = createClient();
  const patch: Record<string, unknown> = {};
  if (department_tag !== undefined) patch.department_tag = department_tag;
  if (role) {
    if (me.role !== "admin") return Response.json({ error: "only admin changes roles" }, { status: 403 });
    patch.role = role;
  }
  const { error } = await supa.from("profiles").update(patch).eq("id", user_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { users: user_id, ...patch } });
  return Response.json({ ok: true });
}
