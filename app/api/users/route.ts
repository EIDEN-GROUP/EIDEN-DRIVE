export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { parseJson } from "@/lib/http";

// Managers/Admins: full directory incl. emails + sign-in info (auth data is
// service-role only — never exposed to members). Members use the page's
// RLS-safe profiles query instead.
export async function GET() {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const { data: profiles } = await db.from("profiles").select("id,username,role,department_tag").order("username").limit(200);
  const { data: users } = await db.auth.admin.listUsers();
  const byId = new Map((users?.users ?? []).map((u) => [u.id, u]));
  return Response.json({
    results: (profiles ?? []).map((p: { id: string; username: string; role: string; department_tag: string | null }) => {
      const u = byId.get(p.id) as { email?: string; created_at?: string; last_sign_in_at?: string } | undefined;
      return { ...p, email: u?.email ?? null, created_at: u?.created_at ?? null, last_sign_in_at: u?.last_sign_in_at ?? null };
    })
  });
}

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

const Remove = z.object({ user_id: z.string().uuid() });

// Admin-only: remove a member entirely. Guards: never yourself, never the last admin.
// Profile row first (FK), then the auth user. Audited.
export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me || me.role !== "admin") return Response.json({ error: "admins only" }, { status: 403 });
  const p = await parseJson(req, Remove);
  if (p.error) return p.error;
  if (p.data.user_id === me.id) return Response.json({ error: "you cannot remove yourself" }, { status: 400 });

  const db = adminClient();
  const { data: target } = await db.from("profiles").select("id,role,username").eq("id", p.data.user_id).maybeSingle();
  if (!target) return Response.json({ error: "user not found" }, { status: 404 });
  if (target.role === "admin") {
    const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 1) <= 1) return Response.json({ error: "cannot remove the last admin" }, { status: 400 });
  }
  const { error: pErr } = await db.from("profiles").delete().eq("id", p.data.user_id);
  if (pErr) return Response.json({ error: pErr.message }, { status: 500 });
  const { error: uErr } = await db.auth.admin.deleteUser(p.data.user_id);
  if (uErr) return Response.json({ error: uErr.message, note: "profile removed, auth user kept — retry or remove in Supabase dashboard" }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "perm-delete", req, detail: { users: p.data.user_id, username: target.username } });
  return Response.json({ ok: true });
}
