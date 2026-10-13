export const dynamic = "force-dynamic";

import { z } from "zod";
import { getProfile } from "@/lib/roles";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { consumePairingToken, bindSlackAccount, unbindSlackAccount, linkedEidenUser } from "@/lib/slack-links";
import { parseJson } from "@/lib/http";
import { rateLimited, clientIp } from "@/lib/rate";

const mask = (id: string) => (id.length > 4 ? `${id.slice(0, 2)}…${id.slice(-4)}` : "…");

// GET /api/slack/connect?token=&workspace=&user= — token status for the
// landing page. Reveals only validity + masked identity (the token itself is
// unguessable; no Eiden session needed to READ status, only to confirm).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = u.searchParams.get("token") ?? "";
  const workspace = u.searchParams.get("workspace") ?? "";
  const user = u.searchParams.get("user") ?? "";
  if (!token || !workspace || !user) return Response.json({ ok: false, error: "bad link" }, { status: 400 });
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const { data } = await adminClient().from("slack_pairing")
    .select("workspace_id,slack_user_id,expires_at,used_at").eq("token", token).maybeSingle();
  const row = (data ?? null) as { workspace_id: string; slack_user_id: string; expires_at: string; used_at: string | null } | null;
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    return Response.json({ ok: false, error: "link expired — start over from Slack" }, { status: 410 });
  }
  if (row.workspace_id !== workspace || row.slack_user_id !== user) {
    return Response.json({ ok: false, error: "link doesn't match — start over from Slack" }, { status: 400 });
  }
  const me = await getProfile();
  const already = me ? await linkedEidenUser(workspace, user) : null;
  return Response.json({
    ok: true, workspace, slack_user: mask(user),
    signed_in: !!me, signed_in_as: me?.username ?? null,
    already_linked: !!already && already.id === me?.id,
  });
}

const Confirm = z.object({ token: z.string().min(8).max(200), workspace: z.string().min(1).max(32), user: z.string().min(1).max(32) });
const Bye = z.object({ disconnect: z.literal(true), workspace: z.string().min(1).max(32), user: z.string().min(1).max(32) });

// POST /api/slack/connect — confirm (or disconnect) the link. Requires an
// Eiden session: the SIGNED-IN account is what gets linked, and the pairing
// token must match the Slack identity (no arbitrary-ID trust).
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "sign in to Eiden Drive first", code: "unauthorized" }, { status: 401 });
  if (rateLimited(`slack-link:${me.id}`, 10)) {
    return Response.json({ error: "slow down — try again in a minute" }, { status: 429 });
  }
  const p = await parseJson(req, z.union([Confirm, Bye]));
  if (p.error) return p.error;

  if ("disconnect" in p.data) {
    const { workspace, user } = p.data;
    // Only your OWN link: the row must point at the signed-in account.
    const link = await linkedEidenUser(workspace, user);
    if (!link || link.id !== me.id) {
      return Response.json({ error: "that Slack account isn't linked to you", code: "not_linked" }, { status: 404 });
    }
    const r = await unbindSlackAccount(me.id, workspace, user);
    if (!r.ok) return Response.json({ error: r.error }, { status: 500 });
    return Response.json({ ok: true, disconnected: true });
  }

  const { token, workspace, user } = p.data;
  const consumed = await consumePairingToken(token, workspace, user);
  if (!consumed.ok) return Response.json({ error: consumed.error, code: "bad_link" }, { status: 400 });
  const bound = await bindSlackAccount(me.id, consumed.pairing.workspace_id, consumed.pairing.slack_user_id);
  if (!bound.ok) return Response.json({ error: bound.error, code: bound.code }, { status: 409 });
  return Response.json({ ok: true, linked: true });
}
