export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { getAccounts, type DriveAccount } from "@/lib/drive-accounts";
import { inScopeGoogleIds, allBinnedIds, accessContext, isManager } from "@/lib/visibility";
import { parseQuery } from "@/lib/http";

const Q = z.object({ accountId: z.string().uuid() });

// Full Google tree for one ACTIVE account (folders AND files, capped) so the
// Explorer can render drives > folders > files from the index. Disabled drives
// are invisible here too.
export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = parseQuery(req, Q);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const accounts = await getAccounts() as (DriveAccount & { refresh_token: string })[];
  const acct = accounts.find((a) => a.id === p.data.accountId);
  if (!acct || acct.status !== "active") return Response.json({ error: "drive not available" }, { status: 404 });
  const db = adminClient();
  const { data, error } = await db.from("file_index")
    .select("id,name,mime,size,google_file_id,google_parent_id,backends,owner")
    .eq("drive_account_id", p.data.accountId)
    .not("google_file_id", "is", null)
    .order("name")
    .limit(2000);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  type TRow = { id: string; google_file_id: string; google_parent_id: string | null; owner?: string | null };
  // Binned rows hide here too (they live on the Recovery Bin page).
  const binned = await allBinnedIds(db);
  let all = ((data ?? []) as TRow[])
    .filter((r) => !binned.has(r.id));
  // Department-tag mode: members see only own rows, rows carrying their tag,
  // and tagged folders' whole subtrees — consistently with the Workspace list.
  // (Fallback: no assigned matching tag → everything shows, same as the list.)
  if (!isManager(me.role)) {
    const ctx = await accessContext(db, me);
    if (ctx.strict) {
      const byGoogle = new Map(all.map((r) => [r.google_file_id, r]));
      const kidsOf = new Map<string, string[]>();
      for (const r of all) {
        if (r.google_parent_id) {
          const l = kidsOf.get(r.google_parent_id) ?? [];
          l.push(r.google_file_id);
          kidsOf.set(r.google_parent_id, l);
        }
      }
      const keep = new Set<string>();
      const grow = (gid: string) => {
        if (keep.has(gid)) return;
        keep.add(gid);
        for (const c of kidsOf.get(gid) ?? []) grow(c);
      };
      for (const r of all) {
        if (r.owner === me.id || ctx.taggedFiles.has(r.id)) grow(r.google_file_id);
      }
      all = all.filter((r) => keep.has(r.google_file_id));
    }
  }
  // Scope server-side (never trust the client to trim the tree): on a scoped
  // account only the root's subtree leaves this endpoint. Navigating to an
  // out-of-scope folder id by hand finds nothing here. Placeless rows
  // (no recorded parent) stay visible — account-confined, never cross-account.
  let rows = all;
  if (acct.root_id) {
    const scope = await inScopeGoogleIds(db, acct.id, acct.root_id);
    if (scope) {
      rows = all.filter((r) => scope.ids.has(r.google_file_id) || (r.google_parent_id == null && scope.noparent.has(r.google_file_id)));
    }
    // The scope root itself (when indexed) stays visible as the tree's anchor.
    const rootRow = all.find((r) => r.google_file_id === acct.root_id);
    if (rootRow && !rows.includes(rootRow)) rows = [rootRow, ...rows];
  }
  // The client scopes the tree top to this root: children of rootId only.
  // (parent-less legacy rows predate scoping — resync-clean removes them.)
  return Response.json({ results: rows, rootId: acct.root_id ?? null });
}
