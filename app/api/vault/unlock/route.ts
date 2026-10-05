import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";

const Unlock = z.object({ method: z.enum(["totp", "webauthn"]), token: z.string().min(1) });

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { method } = Unlock.parse(await req.json());
  // TODO P2: verify TOTP (otplib) / WebAuthn (@simplewebauthn/server) against enrolled credential.
  // Stub accepts shape + logs; real verify wired once .env + enrollment UI land (left for the end per user).
  const supa = createClient();
  await supa.from("vault_auth").upsert({ user_id: me.id, authed_at: new Date().toISOString(), method });
  await logAudit({ actor: me.id, actor_name: me.username, action: "vault-view", req, detail: { method } });
  return Response.json({ ok: true, valid_hours: 6, method });
}

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supa = createClient();
  const { data: auth } = await supa.from("vault_auth").select("authed_at").eq("user_id", me.id).single();
  const valid = auth?.authed_at ? Date.now() - new Date(auth.authed_at).getTime() < 6 * 3600_000 : false;
  if (!valid) return Response.json({ error: "re-auth required", valid: false }, { status: 403 });
  // Only managers/admins see who created what; members see own items (RLS reinforces).
  const { data } = await supa.from("vault_items").select("id,created_at").limit(50);
  return Response.json({ valid: true, items: data ?? [], note: "ciphertext decrypted client-side after 2FA" });
}

export async function PUT(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "create-vault")) return Response.json({ error: "managers only" }, { status: 403 });
  const body = await req.json() as { owner: string; enc_blob: string };
  const supa = createClient();
  const { data, error } = await supa.from("vault_items").insert({ owner: body.owner, enc_blob: body.enc_blob, created_by: me.id }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, id: data.id });
}
