export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { signedDownloadUrl } from "@/lib/storage";
import { parseJson } from "@/lib/http";

// Own profile + a fresh signed avatar URL (null when no picture set).
export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = adminClient();
  const { data: p } = await db.from("profiles")
    .select("id,username,role,department_tag,phone,avatar_path,created_at").eq("id", me.id).maybeSingle();
  if (!p) return Response.json({ error: "profile not found" }, { status: 404 });
  let avatarUrl: string | null = null;
  if (p.avatar_path) {
    try { avatarUrl = await signedDownloadUrl(p.avatar_path); } catch { avatarUrl = null; }
  }
  return Response.json({ ...p, avatarUrl });
}

const Update = z.object({
  phone: z.string().max(40).nullable().optional(),
  avatar_path: z.string().max(600).nullable().optional(),
  username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._-]+$/i).optional()
});

// Editable today: username (unique, yours to pick at onboarding), phone, avatar.
// Role/dept stay admin-managed (permission boundaries).
export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Update);
  if (p.error) return p.error;
  // Avatar must live under the caller's own upload prefix (same rule as uploads).
  if (p.data.avatar_path && (!p.data.avatar_path.startsWith(`${me.id}/`) || p.data.avatar_path.includes(".."))) {
    return Response.json({ error: "avatar must be inside your own upload folder" }, { status: 403 });
  }
  const patch: Record<string, unknown> = {};
  if (p.data.phone !== undefined) patch.phone = p.data.phone;
  if (p.data.avatar_path !== undefined) patch.avatar_path = p.data.avatar_path;
  const db = adminClient();
  if (p.data.username !== undefined && p.data.username.toLowerCase() !== me.username.toLowerCase()) {
    const { data: taken } = await db.from("profiles").select("id").ilike("username", p.data.username).neq("id", me.id).maybeSingle();
    if (taken) return Response.json({ error: "that name is taken — try another" }, { status: 409 });
    patch.username = p.data.username;
  }
  if (!Object.keys(patch).length) return Response.json({ error: "nothing to update" }, { status: 400 });
  const { error } = await db.from("profiles").update(patch).eq("id", me.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
