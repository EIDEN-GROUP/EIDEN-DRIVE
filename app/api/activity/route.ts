export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { getProfile } from "@/lib/roles";
import { parseQuery } from "@/lib/http";

const Q = z.object({
  q: z.string().max(120).optional(),
  action: z.string().max(40).optional(),
  actor: z.string().max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(120)
});

// Audit trail feed. Authenticated users; Supabase RLS decides which rows each
// role may see (same rule as the old server-rendered page).
export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = parseQuery(req, Q);
  if (p.error) return p.error;
  const { q, action, actor, from, to, limit } = p.data;
  const supa = createClient();
  let query = supa.from("audit_logs")
    .select("id,actor_name,action,file_id,detail,ip,ts")
    .order("ts", { ascending: false }).limit(limit);
  if (action) query = query.eq("action", action);
  if (actor) query = query.ilike("actor_name", `%${actor}%`);
  if (from) query = query.gte("ts", `${from}T00:00:00`);
  if (to) query = query.lte("ts", `${to}T23:59:59`);
  if (q) query = query.or(`actor_name.ilike.%${q}%,action.ilike.%${q}%,ip.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ results: data ?? [] });
}
