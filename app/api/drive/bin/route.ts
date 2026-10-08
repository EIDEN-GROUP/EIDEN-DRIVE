export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { getProfile, can } from "@/lib/roles";
import { isManager } from "@/lib/visibility";

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supa = createClient();
  const { data, error } = await supa.from("recovery_bin")
    .select("file_id,deleted_at,purge_at,file_index(id,name,mime,size,updated_at,owner)")
    .order("deleted_at", { ascending: false }).limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  // Members see their own trashed files; managers see everyone's.
  const rows = (data ?? []) as { file_id: string; file_index: { owner?: string } | { owner?: string }[] | null }[];
  const mine = (r: (typeof rows)[number]) => {
    const fi = Array.isArray(r.file_index) ? r.file_index[0] : r.file_index;
    return fi?.owner === me.id;
  };
  return Response.json({ results: isManager(me.role) ? data : data?.filter(mine) ?? [], canPurge: can(me.role, "perm-delete") });
}
