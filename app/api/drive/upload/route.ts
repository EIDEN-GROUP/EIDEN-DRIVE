export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { logAudit } from "@/lib/audit";
import { getProfile } from "@/lib/roles";
import { parseJson } from "@/lib/http";

// Metadata-only: bytes already went to Supabase Storage via a signed URL (or the agent staged them).
// Registers file_index + version + audit. storage_path must live under the caller's own prefix.
const Body = z.object({
  name: z.string().trim().min(1).max(255),
  mime: z.string().max(127).optional(),
  size: z.number().int().nonnegative().max(1024 ** 4).optional(),
  hash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  backends: z.array(z.enum(["google", "local", "backup"])).min(1).max(3).optional(),
  folder: z.string().uuid().nullable().optional(),
  storage_path: z.string().max(600).nullable().optional()
});

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const body = p.data;
  if (body.storage_path && (!body.storage_path.startsWith(`${me.id}/`) || body.storage_path.includes(".."))) {
    return Response.json({ error: "storage_path must be inside your own upload folder" }, { status: 403 });
  }
  // Writes use the service role AFTER the checks above (never trust anon RLS for
  // mutations: a missing/rotated JWT must never turn into a data-loss-shaped error).
  const db = adminClient();
  const { data, error } = await db.from("file_index").insert({
    name: body.name, mime: body.mime ?? "application/octet-stream", size: body.size ?? 0,
    hash: body.hash ?? null, backends: body.backends ?? ["google"], owner: me.id, folder: body.folder ?? null,
    storage_path: body.storage_path ?? null
  }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await db.from("versions").insert({ file_id: data.id, v: 1, hash: body.hash ?? "", actor: me.id });
  await logAudit({ actor: me.id, actor_name: me.username, action: "add", file_id: data.id, req, detail: { backends: body.backends } });
  return Response.json({ ok: true, id: data.id });
}
