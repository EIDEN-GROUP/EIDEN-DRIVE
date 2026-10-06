export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { parseJson } from "@/lib/http";

const Update = z.object({
  user_id: z.string().uuid(),
  department_tag: z.string().max(60).nullable().optional(),
  role: z.enum(["admin", "manager", "member"]).optional()
}).refine((v) => v.department_tag !== undefined || v.role !== undefined, { message: "nothing to update" });

// Manager/Admin only: assign dept tag; role changes are Admin-only. Managers can never touch an Admin account.
// Writes use the service role (profiles has no client-side UPDATE policy) AFTER these checks.
export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "assign-tag")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Update);
  if (p.error) return p.error;
  const { user_id, department_tag, role } = p.data;

  const db = adminClient();
  const { data: target } = await db.from("profiles").select("id,role").eq("id", user_id).maybeSingle();
  if (!target) return Response.json({ error: "user not found" }, { status: 404 });
  if (target.role === "admin" && me.role !== "admin") return Response.json({ error: "only an admin can change an admin" }, { status: 403 });
  if (role && me.role !== "admin") return Response.json({ error: "only admin changes roles" }, { status: 403 });
  if (role && user_id === me.id && role !== "admin") return Response.json({ error: "admins cannot demote themselves" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (department_tag !== undefined) patch.department_tag = department_tag;
  if (role) patch.role = role;
  const { error } = await db.from("profiles").update(patch).eq("id", user_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { users: user_id, ...patch } });
  return Response.json({ ok: true });
}
