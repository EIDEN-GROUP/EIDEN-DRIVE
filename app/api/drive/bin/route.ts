export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { isManager, accessContext, folderUsable } from "@/lib/visibility";
import { dbError } from "@/lib/http";

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supa = createClient();
  // 1000, not 100: the old cap silently hid members' trashed files past it
  // (90-day retention makes 100 reachable). Fully paginated would be nicer;
  // this covers realistic bins without a protocol change.
  const { data, error } = await supa.from("recovery_bin")
    .select("file_id,deleted_at,purge_at,file_index(id,name,mime,size,updated_at,owner,folder)")
    .order("deleted_at", { ascending: false }).limit(1000);
  if (error) return dbError("Couldn't load the Recovery Bin.")(error);
  // Members see files they could restore (own / department-inherited —
  // evaluated with the same helper the restore route enforces); managers see
  // everyone's. Eligibility for Drive-anchored rows is re-checked at restore
  // time (ancestry can shift), so the list stays a superset, never a promise.
  const rows = (data ?? []) as { file_id: string; file_index: { id: string; owner?: string; folder?: string | null } | { id: string; owner?: string; folder?: string | null }[] | null }[];
  let files = rows;
  if (!isManager(me.role)) {
    const ctx = await accessContext(adminClient(), { id: me.id, role: me.role, department_tag: me.department_tag });
    files = rows.filter((r) => {
      const fi = Array.isArray(r.file_index) ? r.file_index[0] : r.file_index;
      if (!fi) return false;
      if (fi.owner === me.id) return true;
      if (ctx.taggedFiles.has(fi.id)) return true;
      return !!fi.folder && ctx.folders !== null && ctx.folders.has(fi.folder);
    });
  }
  // Binned folders (folder-aware bin): members see subtrees they could
  // restore; managers see all. Restored via POST /api/drive/restore folder_id.
  let folders: unknown[] = [];
  try {
    const { data: fb } = await supa.from("folder_bin")
      .select("folder_id,deleted_at,purge_at,folders(id,name,parent,dept)")
      .order("deleted_at", { ascending: false }).limit(200);
    const frows = ((fb ?? []) as unknown as { folder_id: string; deleted_at: string; purge_at: string; folders: { id: string; name: string } | { id: string; name: string }[] | null }[])
      .map((r) => ({ ...r, folders: Array.isArray(r.folders) ? r.folders[0] ?? null : r.folders }))
      .filter((r) => r.folders);
    if (isManager(me.role)) {
      folders = frows;
    } else {
      const kept = [];
      for (const r of frows) {
        const dst = await folderUsable(adminClient(), { id: me.id, role: me.role, department_tag: me.department_tag }, r.folder_id, { allowBinned: true });
        // folderUsable proves membership but not binned-state; the row came
        // from folder_bin, so binned is given — usable ⇒ restorable.
        if (dst.ok) kept.push(r);
      }
      folders = kept;
    }
  } catch { /* pre-migration 0020: no folder bin yet */ }
  return Response.json({ results: isManager(me.role) ? data : files, folders, canPurge: can(me.role, "perm-delete") });
}
