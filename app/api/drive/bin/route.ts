export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { getProfile, can } from "@/lib/roles";
import { isManager } from "@/lib/visibility";
import { dbError } from "@/lib/http";

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supa = createClient();
  // 1000, not 100: the old cap silently hid members' trashed files past it
  // (90-day retention makes 100 reachable). Fully paginated would be nicer;
  // this covers realistic bins without a protocol change.
  const { data, error } = await supa.from("recovery_bin")
    .select("file_id,deleted_at,purge_at,file_index(id,name,mime,size,updated_at,owner)")
    .order("deleted_at", { ascending: false }).limit(1000);
  if (error) return dbError("Couldn't load the Recovery Bin.")(error);
  // Members see their own trashed files; managers see everyone's.
  const rows = (data ?? []) as { file_id: string; file_index: { owner?: string } | { owner?: string }[] | null }[];
  const mine = (r: (typeof rows)[number]) => {
    const fi = Array.isArray(r.file_index) ? r.file_index[0] : r.file_index;
    return fi?.owner === me.id;
  };
  return Response.json({ results: isManager(me.role) ? data : data?.filter(mine) ?? [], canPurge: can(me.role, "perm-delete") });
}
