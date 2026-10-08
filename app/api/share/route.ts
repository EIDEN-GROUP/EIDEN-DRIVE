export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { newToken, tokenHash } from "@/lib/share";
import { parseJson, parseQuery } from "@/lib/http";

// Owners and managers can mint public preview links. The link previews only —
// edit, list and enumerate stay behind login. Expiry capped at 90 days.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, z.object({ file_id: z.string().uuid(), days: z.number().int().min(1).max(90).default(30) }));
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const { data: f } = await db.from("file_index").select("id,name,owner").eq("id", p.data.file_id).maybeSingle();
  const file = f as { id: string; name: string; owner: string } | null;
  if (!file) return Response.json({ error: "file not found" }, { status: 404 });
  if (file.owner !== me.id && me.role !== "admin" && me.role !== "manager") {
    return Response.json({ error: "only the owner or a manager can share this file" }, { status: 403 });
  }
  const token = newToken();
  const { error } = await db.from("share_links").insert({
    token_hash: tokenHash(token), file_id: file.id, created_by: me.id,
    expires_at: new Date(Date.now() + p.data.days * 86400_000).toISOString()
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  await logAudit({ actor: me.id, actor_name: me.username, action: "share", file_id: file.id, req, detail: { share_days: p.data.days } });
  return Response.json({ ok: true, url: `${origin}/s/${token}`, expires_days: p.data.days }, { status: 201 });
}

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = parseQuery(req, z.object({ file_id: z.string().uuid() }));
  if (p.error) return p.error;
  const db = adminClient();
  const { data } = await db.from("share_links").select("id,created_at,expires_at").eq("file_id", p.data.file_id).order("created_at", { ascending: false }).limit(10);
  // Note: URLs are shown once at creation (only the hash is stored).
  return Response.json({
    results: ((data ?? []) as { id: string; created_at: string; expires_at: string }[]).map((l) => ({
      id: l.id, created_at: l.created_at, expires_at: l.expires_at,
      expired: new Date(l.expires_at).getTime() < Date.now()
    }))
  });
}

// Revoke = delete the row. The URL dies instantly (hash lookup finds nothing).
export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, z.object({ id: z.string().uuid() }));
  if (p.error) return p.error;
  const db = adminClient();
  const { data: l } = await db.from("share_links").select("id,file_id").eq("id", p.data.id).maybeSingle();
  const link = l as { id: string; file_id: string } | null;
  if (!link) return Response.json({ error: "link not found" }, { status: 404 });
  const { data: f } = await db.from("file_index").select("owner").eq("id", link.file_id).maybeSingle();
  if ((f as { owner?: string } | null)?.owner !== me.id && me.role !== "admin" && me.role !== "manager") {
    return Response.json({ error: "only the owner or a manager can revoke this link" }, { status: 403 });
  }
  await db.from("share_links").delete().eq("id", link.id);
  await logAudit({ actor: me.id, actor_name: me.username, action: "share", file_id: link.file_id, req, detail: { share_revoked: link.id } });
  return Response.json({ ok: true });
}
