export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { getProfile, can } from "@/lib/roles";

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supa = createClient();
  const { data, error } = await supa.from("recovery_bin")
    .select("file_id,deleted_at,purge_at,file_index(id,name,mime,size,updated_at)")
    .order("deleted_at", { ascending: false }).limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ results: data ?? [], canPurge: can(me.role, "perm-delete") });
}
