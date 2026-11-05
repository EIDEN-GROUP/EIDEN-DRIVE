export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { canTouch, googleInScope, isBinned, binnedResponse, googlePinOf, folderUsable, isFolderBinned } from "@/lib/visibility";
import { getAccounts } from "@/lib/drive-accounts";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { newToken, tokenHash } from "@/lib/share";
import { rateLimited, clientIp } from "@/lib/rate";
import { parseJson, parseQuery } from "@/lib/http";

const DAYS = z.number().int().min(1).max(90).default(30);

async function validateFile(db: ReturnType<typeof adminClient>, file_id: string, me: { id: string; role: string; department_tag?: string | null }) {
  const { data: f } = await db.from("file_index").select("id,name,owner,folder,google_file_id,google_parent_id,drive_account_id").eq("id", file_id).maybeSingle();
  const file = f as { id: string; name: string; owner: string; folder: string | null; google_file_id?: string | null; drive_account_id?: string | null } | null;
  if (!file) return { error: { not: "found" } };
  const gate = await canTouch(db, me as { id: string; role: string }, file, googlePinOf(file));
  if (!gate.ok) return { error: { access: gate.reason ?? "only files in your space can be shared" } };
  if (file.google_file_id) {
    if (!(await googleInScope(db, await getAccounts(), file.drive_account_id, file.google_file_id))) {
      return { error: { scope: "outside this drive's shared scope" } };
    }
  }
  if (await isBinned(db, file.id)) return { error: { binned: true } };
  return { file };
}

async function revokeAllowed(db: ReturnType<typeof adminClient>, link: { id: string; file_id: string | null; folder_id: string | null; created_by: string | null }, me: { id: string; role: string }) {
  if (link.file_id) {
    const { data: f } = await db.from("file_index").select("owner").eq("id", link.file_id).maybeSingle();
    return (f as { owner?: string } | null)?.owner === me.id || me.role === "admin" || me.role === "manager";
  }
  if (link.folder_id) {
    const { data: f } = await db.from("folders").select("created_by").eq("id", link.folder_id).maybeSingle();
    return me.role === "admin" || me.role === "manager" || (f as { created_by?: string } | null)?.created_by === me.id || link.created_by === me.id;
  }
  return false;
}

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (rateLimited(`share-mint:${me.id}`, 30) || rateLimited(`share-mint:ip:${clientIp(req)}`, 60)) {
    return Response.json({ error: "slow down — too many share links" }, { status: 429 });
  }
  const p = await parseJson(req, z.object({
    file_id: z.string().uuid().optional(),
    folder_id: z.string().uuid().optional(),
    days: DAYS,
  }).refine((v) => Boolean(v.file_id) !== Boolean(v.folder_id), { message: "pass exactly one of file_id or folder_id" }));
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  if (p.data.file_id) {
    const r = await validateFile(db, p.data.file_id, me);
    if ("error" in r) {
      const err = (r as { error: Record<string, unknown> }).error;
      if (err.not) return Response.json({ error: "file not found" }, { status: 404 });
      if (err.binned) return binnedResponse();
      return Response.json({ error: Object.values(err)[0] }, { status: 403 });
    }
    const file = r.file;
    const token = newToken();
    const { error } = await db.from("share_links").insert({
      token_hash: tokenHash(token), file_id: file.id, folder_id: null, kind: "file", created_by: me.id,
      expires_at: new Date(Date.now() + p.data.days * 86400_000).toISOString()
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await logAudit({ actor: me.id, actor_name: me.username, action: "share", file_id: file.id, req, detail: { share_days: p.data.days } });
    return Response.json({ ok: true, url: `${origin}/s/${token}`, expires_days: p.data.days }, { status: 201 });
  }
  const { data: folder } = await db.from("folders").select("id,name").eq("id", p.data.folder_id).maybeSingle();
  if (!folder) return Response.json({ error: "folder not found" }, { status: 404 });
  const fol = folder as { id: string; name: string };
  const gate = await folderUsable(db, me, fol.id);
  if (!gate.ok) return Response.json({ error: gate.reason ?? "only folders in your space can be shared" }, { status: 403 });
  if (await isFolderBinned(db, fol.id)) return binnedResponse();
  const token = newToken();
  const { error } = await db.from("share_links").insert({
    token_hash: tokenHash(token), file_id: null, folder_id: fol.id, kind: "folder", created_by: me.id,
    expires_at: new Date(Date.now() + p.data.days * 86400_000).toISOString()
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "share", file_id: null, req, detail: { share_days: p.data.days, kind: "folder" } });
  return Response.json({ ok: true, url: `${origin}/s/${token}`, expires_days: p.data.days }, { status: 201 });
}

export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = parseQuery(req, z.object({
    file_id: z.string().uuid().optional(),
    folder_id: z.string().uuid().optional(),
  }).refine((v) => Boolean(v.file_id) !== Boolean(v.folder_id), { message: "pass exactly one of file_id or folder_id" }));
  if (p.error) return p.error;
  const db = adminClient();
  if (p.data.folder_id) {
    const { data: f } = await db.from("folders").select("id,name").eq("id", p.data.folder_id).maybeSingle();
    if (!f) return Response.json({ error: "folder not found" }, { status: 404 });
    const gate = await folderUsable(db, me, p.data.folder_id);
    if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 });
    const { data } = await db.from("share_links").select("id,created_at,expires_at").eq("folder_id", p.data.folder_id).order("created_at", { ascending: false }).limit(10);
    const results = ((data ?? []) as { id: string; created_at: string; expires_at: string }[]).map((l) => ({ id: l.id, created_at: l.created_at, expires_at: l.expires_at, expired: new Date(l.expires_at).getTime() < Date.now() }));
    return Response.json({ results });
  }
  const { data: f } = await db.from("file_index").select("id,owner,folder").eq("id", p.data.file_id!).maybeSingle();
  if (!f) return Response.json({ error: "file not found" }, { status: 404 });
  const gate = await canTouch(db, me, f as { id: string; owner: string; folder: string | null });
  if (!gate.ok) return Response.json({ error: gate.reason ?? "not allowed" }, { status: 403 });
  const { data } = await db.from("share_links").select("id,created_at,expires_at").eq("file_id", p.data.file_id!).order("created_at", { ascending: false }).limit(10);
  const results = ((data ?? []) as { id: string; created_at: string; expires_at: string }[]).map((l) => ({ id: l.id, created_at: l.created_at, expires_at: l.expires_at, expired: new Date(l.expires_at).getTime() < Date.now() }));
  return Response.json({ results });
}

export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, z.object({ id: z.string().uuid() }));
  if (p.error) return p.error;
  const db = adminClient();
  const { data: l } = await db.from("share_links").select("id,file_id,folder_id,created_by").eq("id", p.data.id).maybeSingle();
  const link = l as { id: string; file_id: string | null; folder_id: string | null; created_by: string | null } | null;
  if (!link) return Response.json({ error: "link not found" }, { status: 404 });
  const allowed = await revokeAllowed(db, link, me);
  if (!allowed) return Response.json({ error: "only the owner, the creator, or a manager can revoke this link" }, { status: 403 });
  await db.from("share_links").delete().eq("id", link.id);
  await logAudit({ actor: me.id, actor_name: me.username, action: "share", file_id: link.file_id, req, detail: { share_revoked: link.id, folder_id: link.folder_id } });
  return Response.json({ ok: true });
}
