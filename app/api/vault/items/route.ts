export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { parseJson } from "@/lib/http";
import { openItem, sealItem, vaultKey, vaultSessionValid } from "@/lib/vault";

// Every route here needs (1) a signed-in user and (2) an UNLOCKED vault session (valid TOTP within 6 h).
async function gate() {
  const me = await getProfile();
  if (!me) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  const { data } = await adminClient().from("vault_auth").select("authed_at").eq("user_id", me.id).maybeSingle();
  if (!vaultSessionValid((data as { authed_at: string | null } | null)?.authed_at ?? null)) {
    return { error: Response.json({ error: "vault is locked — unlock it with your authenticator code", locked: true }, { status: 403 }) };
  }
  const key = vaultKey();
  if (!key) return { error: Response.json({ error: "Vault encryption key is not configured on the server (VAULT_KEK).", unconfigured: true }, { status: 503 }) };
  return { me, key };
}

interface Row { id: string; owner: string | null; created_by: string | null; created_at: string; enc_blob: string }

// List: labels / usernames / urls only. Passwords are never in the list — they need an explicit, audited reveal.
export async function GET() {
  const g = await gate();
  if (g.error) return g.error;
  const { me, key } = g;
  const db = adminClient();
  let q = db.from("vault_items").select("id,owner,created_by,created_at,enc_blob").order("created_at", { ascending: false }).limit(200);
  if (!can(me.role, "create-vault")) q = q.eq("owner", me.id); // members see only their own
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as Row[];
  const ids = Array.from(new Set(rows.flatMap((r) => [r.owner, r.created_by]).filter(Boolean) as string[]));
  const { data: ppl } = ids.length ? await db.from("profiles").select("id,username").in("id", ids) : { data: [] };
  const name = new Map(((ppl ?? []) as { id: string; username: string }[]).map((p) => [p.id, p.username]));
  const items = [];
  for (const r of rows) {
    try {
      const d = await openItem(r.enc_blob, key);
      items.push({ id: r.id, label: d.label, username: d.username ?? null, url: d.url ?? null, hasNotes: !!d.notes, owner: r.owner, ownerName: r.owner ? name.get(r.owner) ?? null : null,
        createdBy: r.created_by ? name.get(r.created_by) ?? null : null, created_at: r.created_at });
    } catch {
      items.push({ id: r.id, label: "Unreadable item", username: null, url: null, hasNotes: false, owner: r.owner, ownerName: null, createdBy: null, created_at: r.created_at, broken: true });
    }
  }
  return Response.json({ items, canCreate: can(me.role, "create-vault"), role: me.role });
}

const Create = z.object({
  label: z.string().trim().min(1).max(80),
  username: z.string().trim().max(160).optional(),
  url: z.string().trim().max(300).optional(),
  secret: z.string().min(1).max(4000),
  notes: z.string().max(4000).optional(),
  owner: z.string().uuid().optional()
});

// Managers / admins create items (for themselves or a member). Encrypted before it touches the database.
export async function POST(req: Request) {
  const g = await gate();
  if (g.error) return g.error;
  const { me, key } = g;
  if (!can(me.role, "create-vault")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, Create);
  if (p.error) return p.error;
  const { owner, ...doc } = p.data;
  const db = adminClient();
  const ownerId = owner ?? me.id;
  if (owner) {
    const { data: o } = await db.from("profiles").select("id").eq("id", owner).maybeSingle();
    if (!o) return Response.json({ error: "owner not found" }, { status: 404 });
  }
  const blob = await sealItem(doc, key);
  const { data, error } = await db.from("vault_items").insert({ owner: ownerId, enc_blob: blob, created_by: me.id }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", req, detail: { vault_item: (data as { id: string }).id, label: doc.label, owner: ownerId } });
  return Response.json({ ok: true, id: (data as { id: string }).id }, { status: 201 });
}

export async function DELETE(req: Request) {
  const g = await gate();
  if (g.error) return g.error;
  const { me } = g;
  if (!can(me.role, "create-vault")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = await parseJson(req, z.object({ id: z.string().uuid() }));
  if (p.error) return p.error;
  const { error } = await adminClient().from("vault_items").delete().eq("id", p.data.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "perm-delete", req, detail: { vault_item: p.data.id } });
  return Response.json({ ok: true });
}

// Reveal one item's secret + notes. Own items, or any item for managers. Every reveal is audited.
export async function PATCH(req: Request) {
  const g = await gate();
  if (g.error) return g.error;
  const { me, key } = g;
  const p = await parseJson(req, z.object({ id: z.string().uuid() }));
  if (p.error) return p.error;
  const { data } = await adminClient().from("vault_items").select("id,owner,enc_blob").eq("id", p.data.id).maybeSingle();
  const row = data as { id: string; owner: string | null; enc_blob: string } | null;
  if (!row || (row.owner !== me.id && !can(me.role, "create-vault"))) return Response.json({ error: "not found" }, { status: 404 });
  let doc;
  try { doc = await openItem(row.enc_blob, key); } catch { return Response.json({ error: "this item can't be decrypted (wrong key or damaged data)" }, { status: 422 }); }
  await logAudit({ actor: me.id, actor_name: me.username, action: "vault-view", req, detail: { vault_item: row.id, label: doc.label, result: "revealed" } });
  return Response.json({ secret: doc.secret, notes: doc.notes ?? null });
}
