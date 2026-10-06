export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { parseJson } from "@/lib/http";
import { verifyTotp } from "@/lib/totp";
import { VAULT_SESSION_HOURS } from "@/lib/vault";

const Unlock = z.object({ method: z.enum(["totp", "webauthn"]), token: z.string().min(1).max(64) });
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60_000;

// Real second factor. The 6 h session row (vault_auth) is written ONLY here, with the service role, after a valid code.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Unlock);
  if (p.error) return p.error;
  const { method, token } = p.data;

  if (method === "webauthn") {
    // Passkeys need an enrolled credential + @simplewebauthn/server; refuse instead of pretending to verify.
    return Response.json({ error: "passkey unlock is not available yet — use your authenticator app" }, { status: 501 });
  }

  const db = adminClient();
  const { data: row } = await db.from("vault_totp").select("secret,confirmed,fail_count,locked_until").eq("user_id", me.id).maybeSingle();
  if (!row) return Response.json({ error: "no authenticator enrolled — set one up first", enroll: true }, { status: 403 });
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return Response.json({ error: "too many wrong codes — try again in a few minutes" }, { status: 429 });
  }

  if (!verifyTotp(row.secret, token.trim())) {
    const fails = (row.fail_count ?? 0) + 1;
    await db.from("vault_totp").update({ fail_count: fails >= MAX_FAILS ? 0 : fails, locked_until: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MS).toISOString() : null }).eq("user_id", me.id);
    await logAudit({ actor: me.id, actor_name: me.username, action: "vault-view", req, detail: { method, result: "failed", fails } });
    return Response.json({ error: "invalid code" }, { status: 403 });
  }

  await db.from("vault_totp").update({ confirmed: true, fail_count: 0, locked_until: null }).eq("user_id", me.id);
  await db.from("vault_auth").upsert({ user_id: me.id, authed_at: new Date().toISOString(), method });
  await logAudit({ actor: me.id, actor_name: me.username, action: "vault-view", req, detail: { method, result: "ok" } });
  return Response.json({ ok: true, valid_hours: VAULT_SESSION_HOURS, method });
}

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supa = createClient();
  const { data: auth } = await supa.from("vault_auth").select("authed_at").eq("user_id", me.id).maybeSingle();
  const valid = auth?.authed_at ? Date.now() - new Date(auth.authed_at).getTime() < VAULT_SESSION_HOURS * 3600_000 : false;
  if (!valid) return Response.json({ error: "re-auth required", valid: false }, { status: 403 });
  // RLS: managers/admins see all items, members only their own.
  const { data } = await supa.from("vault_items").select("id,created_at").limit(50);
  return Response.json({ valid: true, items: data ?? [], note: "ciphertext decrypted client-side after 2FA" });
}

const NewItem = z.object({ owner: z.string().uuid(), enc_blob: z.string().min(1).max(200_000) });

export async function PUT(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "create-vault")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, NewItem);
  if (p.error) return p.error;
  const supa = createClient();
  const { data, error } = await supa.from("vault_items").insert({ owner: p.data.owner, enc_blob: p.data.enc_blob, created_by: me.id }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", req, detail: { vault_item: data.id, owner: p.data.owner } });
  return Response.json({ ok: true, id: data.id });
}
