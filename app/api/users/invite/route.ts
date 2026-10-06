export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { parseJson } from "@/lib/http";

const Invite = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["admin", "manager", "member"]).default("member"),
  department_tag: z.string().trim().max(60).nullable().optional()
});

// Invite-only onboarding. Managers may invite MEMBERS; only admins may invite managers/admins.
// The new auth user gets a profile from the DB trigger (always 'member'); we then set the intended role/department
// with the service role — role is never taken from user-controlled sign-up metadata.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Invite);
  if (p.error) return p.error;
  const { email, role } = p.data;
  const dept = p.data.department_tag || null;
  if (role !== "member" && me.role !== "admin") return Response.json({ error: "only an admin can invite managers or admins" }, { status: 403 });

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const db = adminClient();
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/welcome` });
  if (error || !data?.user) {
    const msg = error?.message ?? "invite failed";
    const exists = /already|registered|exists/i.test(msg);
    return Response.json({ error: exists ? "that email already has an account" : msg }, { status: exists ? 409 : 502 });
  }

  const id = data.user.id;
  const { data: existing } = await db.from("profiles").select("id").eq("id", id).maybeSingle();
  const patch = { role, department_tag: dept };
  const { error: pe } = existing
    ? await db.from("profiles").update(patch).eq("id", id)
    : await db.from("profiles").insert({ id, username: email.split("@")[0].replace(/[^a-z0-9._-]/g, "") || "user", ...patch });
  if (pe) return Response.json({ error: `invited, but could not set role: ${pe.message}` }, { status: 500 });

  await logAudit({ actor: me.id, actor_name: me.username, action: "add", req, detail: { invite: email, role, department_tag: dept } });
  return Response.json({ ok: true, id, email, role, department_tag: dept }, { status: 201 });
}
