export const dynamic = "force-dynamic";

import { getProfile, can } from "@/lib/roles";
import { postSlack, slackConfigured } from "@/lib/slack";

// Managers+: check the wiring + send a live test message to the channel.
export async function GET() {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  return Response.json({ configured: slackConfigured() });
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const r = await postSlack(`✅ Eiden Drive test from *${me.username}* — upload notifications reach this channel. (${origin})`);
  if (!r.ok) return Response.json({ error: r.error }, { status: 502 });
  return Response.json({ ok: true });
}
