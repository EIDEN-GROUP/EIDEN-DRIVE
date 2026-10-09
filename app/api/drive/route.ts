export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { listDriveFiles } from "@/lib/google-drive";
import { getAccounts, clientFor, type DriveAccount } from "@/lib/drive-accounts";
import { withTimeout, googleErrorMessage } from "@/lib/errors";
import { visibleFolderIds, loadFolders, fileOrClause, inScopeGoogleIds, isManager, accessContext, forbiddenTaggedFileIds } from "@/lib/visibility";
import { logAudit } from "@/lib/audit";
import { getProfile } from "@/lib/roles";
import { escapeLike } from "@/lib/http";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").slice(0, 120);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(searchParams.get("offset") ?? 0) || 0, 0);
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supa = createClient();

  // 1) indexed files (Google + Local + Backup badges)
  // Disabled drives are invisible: their rows are excluded (deleted drives
  // leave no pure mirrors behind — DELETE purges them; hybrids keep local bytes).
  // SCOPE (which drive subtree) applies to every role including admins: a drive
  // scoped to folder X never shows the rest of My Drive.
  // PERMISSION (dept/tag confinement) applies to members: own files, untagged
  // Workspace commons, their department's folders, and items carrying their
  // department's tag. Google rows are company drives (no tags): scope only.
  const accounts = await getAccounts() as (DriveAccount & { refresh_token: string })[];
  const labelOf = new Map(accounts.map((a) => [a.id, a.label]));
  const inactive = accounts.filter((a) => a.status !== "active").map((a) => a.id);
  const folders = await loadFolders(supa);
  // Tag tables are service-role-only (RLS deny-all): resolve access with admin.
  const adb = adminClient();
  const ctx = isManager(me.role) ? null : await accessContext(adb, me);
  const visible = ctx ? ctx.folders : visibleFolderIds(folders, me);
  let filesQuery = supa.from("file_index").select("id,name,mime,size,backends,owner,updated_at,folder,hash,storage_path,google_file_id,drive_account_id,google_parent_id").ilike("name", `%${escapeLike(q)}%`);
  if (inactive.length) filesQuery = filesQuery.not("drive_account_id", "in", `(${inactive.join(",")})`);
  const orClause = fileOrClause(me, visible, ctx?.taggedFiles);
  if (orClause) filesQuery = filesQuery.or(orClause);
  if (ctx) {
    const forbidden = await forbiddenTaggedFileIds(adb, me);
    if (forbidden.length) filesQuery = filesQuery.not("id", "in", `(${forbidden.slice(0, 2000).join(",")})`);
  }
  // Hide pre-scope legacy rows (google rows with no account pin) from everyone
  // except managers, who need to see them to clean up. Counted separately so
  // the client can show the resync notice; dropped in JS below (a second OR
  // group can't ride the same PostgREST query as the permission legs).
  let hiddenLegacy = 0;
  if (!isManager(me.role)) {
    const { count } = await supa.from("file_index").select("id", { count: "exact", head: true })
      .is("drive_account_id", null).not("google_file_id", "is", null);
    hiddenLegacy = count ?? 0;
  }
  const { data: rows } = await filesQuery.range(offset, offset + limit - 1);
  // Google rows must sit inside their account's scope (pre-scope leftovers hide).
  // SCOPE APPLIES TO EVERY ROLE — including admins. A drive scoped to folder X
  // shows X's subtree and nothing else. (Dept permission above is separate.)
  type Row = { id: string; name: string; mime: string; size: number; backends: string[]; drive_account_id?: string | null; google_file_id?: string | null };
  let scoped = ((rows ?? []) as Row[]);
  {
    const live = accounts.filter((a) => a.status === "active" && a.root_id);
    if (live.length) {
      const allowed = new Set<string>();
      for (const a of live) {
        const ids = await inScopeGoogleIds(adb, a.id, a.root_id);
        if (ids) for (const id of ids) allowed.add(id);
      }
      scoped = scoped.filter((r) => !r.google_file_id || !r.drive_account_id || allowed.has(r.google_file_id));
    }
  }
  // Pre-scope legacy rows (no account pin): invisible to non-managers.
  // hiddenLegacy (exact count from above) drives the client's resync notice.
  if (!isManager(me.role)) {
    scoped = scoped.filter((r) => !r.google_file_id || r.drive_account_id);
  }

  // 2) live Google fallback, across EVERY connected account — NEVER allowed to
  // 500 the route. A dead token or unreachable root degrades that account to
  // index-only + a reason string; other accounts still merge.
  type Live = { id?: string | null; name?: string | null; mimeType?: string | null; size?: string | null };
  const live: { id: string; name: string; mime?: string; size: number; backends: string[]; accountLabel?: string }[] = [];
  let googleNote = "ok";
  let google_error: string | null = null;
  const errors: string[] = [];
  async function liveFrom(label: string, accountId: string | null, fn: () => Promise<{ files?: Live[]; note?: string }>) {
    try {
      // Live search must never stall the page: 12s then degrade to index-only.
      const g = await withTimeout(12_000, fn(), `"${label}" live search`);
      if (g.note) googleNote = g.note;
      for (const f of (g.files ?? []).slice(0, 10)) {
        // Live (not yet synced) rows carry their account: g:<accountId>:<fileId>.
        // Legacy single-connection rows stay g:<fileId>.
        live.push({ id: accountId ? `g:${accountId}:${f.id}` : `g:${f.id}`, name: f.name ?? "?", mime: f.mimeType ?? undefined, size: Number(f.size ?? 0), backends: ["google"], accountLabel: label });
        if (live.length >= 10) break;
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "google request failed";
      errors.push(`"${label}": ${googleErrorMessage(m)}`);
    }
  }
  if (accounts.some((a) => a.status === "active")) {
    for (const a of accounts.filter((x) => x.status === "active")) {
      if (live.length >= 10) break;
      const d = clientFor(a);
      if (!d) continue;
      await liveFrom(a.label, a.id, () => listDriveFiles(q, undefined, { drive: d, rootId: a.root_id ?? "" }));
    }
  } else {
    await liveFrom("Primary", null, () => listDriveFiles(q));
  }
  if (errors.length) google_error = `${errors.join(" ")} Showing indexed files.`;
  const indexed = scoped.map((r: Row) => ({
    ...r,
    updated: (r as { updated_at?: string }).updated_at,
    accountLabel: r.drive_account_id ? labelOf.get(r.drive_account_id) ?? undefined : undefined
  }));
  // Dedupe: a synced file appears as BOTH its index row and a live g: row.
  // The index row wins (it has actions); live rows only fill gaps for unsynced files.
  const knownGoogle = new Set(
    (scoped as { google_file_id?: string | null }[]).map((r) => r.google_file_id).filter(Boolean)
  );
  const fresh = live.filter((l) => {
    const gid = l.id.startsWith("g:") ? l.id.slice(l.id.lastIndexOf(":") + 1) : l.id;
    return !knownGoogle.has(gid);
  });
  const merged = [...indexed, ...fresh];

  await logAudit({ actor: me.id, actor_name: me.username, action: "view", req, detail: { q } });
  return Response.json({ q, results: merged, google: googleNote, google_error, hiddenLegacy });
}
