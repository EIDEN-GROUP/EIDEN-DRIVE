export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { getProfile, can } from "@/lib/roles";
import { sendMail, smtpStatus } from "@/lib/mail";

// Managers+: mail wiring status + a live test to YOUR OWN inbox.
export async function GET() {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  return Response.json(smtpStatus());
}

export async function POST() {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  const supa = createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user?.email) return Response.json({ error: "no email on this session" }, { status: 400 });
  const r = await sendMail(
    user.email, "Eiden Drive mail test", "Mail is working",
    `<p style="margin:0;">This test came through <strong>your</strong> SMTP server, not Supabase. Sign-in links, invites and verification codes all use this path.</p>`
  );
  if (!r.ok) return Response.json({ error: r.error }, { status: 502 });
  return Response.json({ ok: true, to: user.email });
}
