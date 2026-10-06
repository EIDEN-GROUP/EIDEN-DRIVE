export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { parseJson } from "@/lib/http";

// Own notifications, newest first. Writes elsewhere create them (approvals,
// failed logins, sync errors) — this is the bell feed.
export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = adminClient();
  const { data } = await db.from("notifications").select("id,kind,title,body,read,created_at")
    .eq("user_id", me.id).order("created_at", { ascending: false }).limit(50);
  const unread = (data ?? []).filter((n: { read: boolean }) => !n.read).length;
  return Response.json({ results: data ?? [], unread });
}

const Mark = z.object({ ids: z.array(z.string().uuid()).max(50).optional(), all: z.boolean().optional() });

// Mark own notifications read (by ids, or everything).
export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Mark);
  if (p.error) return p.error;
  const db = adminClient();
  let q = db.from("notifications").update({ read: true }).eq("user_id", me.id);
  if (p.data.ids?.length) q = q.in("id", p.data.ids);
  else if (!p.data.all) return Response.json({ error: "nothing to update" }, { status: 400 });
  const { error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
