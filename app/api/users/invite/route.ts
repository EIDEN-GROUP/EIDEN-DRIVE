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
// The invite EMAIL goes through OUR SMTP (never Supabase's sender): a single-use
// onboarding link (/welcome?token_hash=…). The auth user gets a profile from the
// DB trigger (always 'member'); we then set the intended role/department with
// the service role — role is never taken from user-controlled sign-up metadata.
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
  const { data, error } = await db.auth.admin.generateLink({
    type: "invite", email, options: { redirectTo: `${origin}/welcome` }
  });
  const token_hash = (data as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
  if (error || !data?.user || !token_hash) {
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

  const url = `${origin}/welcome?token_hash=${token_hash}&type=invite`;
  const { sendMail } = await import("@/lib/mail");
  const sent = await sendMail(
    email, "You've been invited to Eiden Drive", `You're invited to Eiden Drive`,
    `<p style="margin:0 0 12px;">${me.username} invited you as <strong>${role}</strong>${dept ? ` in <strong>${dept}</strong>` : ""}. Click below to accept — you'll set up your name, phone and picture, then prove the inbox with a code.</p>
     <p style="margin:0 0 12px;"><a href="${url}" style="display:inline-block;background:#5b3fd0;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Accept invite</a></p>
     <p style="margin:0;color:#6f6f7d;font-size:13px;">Single use, expires in 24 hours. Or paste:<br><span style="word-break:break-all;">${url}</span></p>`
  );
  if (!sent.ok) {
    await logAudit({ actor: me.id, actor_name: me.username, action: "add", req, detail: { invite: email, mail_error: sent.error } });
    return Response.json({ error: `invited, but the email didn't send: ${sent.error}` }, { status: 502 });
  }

  await logAudit({ actor: me.id, actor_name: me.username, action: "add", req, detail: { invite: email, role, department_tag: dept } });
  return Response.json({ ok: true, id, email, role, department_tag: dept }, { status: 201 });
}
