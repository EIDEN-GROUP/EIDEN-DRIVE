export const dynamic = "force-dynamic";

import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { newSecret, otpauthUri } from "@/lib/totp";

// GET → is an authenticator enrolled?   POST → start enrollment (returns the secret ONCE, until confirmed).
export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await adminClient().from("vault_totp").select("confirmed").eq("user_id", me.id).maybeSingle();
  return Response.json({ enrolled: !!data?.confirmed, pending: !!data && !data.confirmed });
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = adminClient();
  const { data: row } = await db.from("vault_totp").select("secret,confirmed").eq("user_id", me.id).maybeSingle();
  if (row?.confirmed) return Response.json({ error: "already enrolled — ask an admin to reset it" }, { status: 409 });
  const secret = row?.secret ?? newSecret();
  if (!row) {
    const { error } = await db.from("vault_totp").insert({ user_id: me.id, secret, confirmed: false });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { panel: "vault-enroll" } });
  return Response.json({ ok: true, secret, otpauth: otpauthUri(secret, me.username) });
}
