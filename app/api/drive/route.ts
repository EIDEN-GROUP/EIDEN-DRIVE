export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { listDriveFiles } from "@/lib/google-drive";
import { getAccounts, clientFor, type DriveAccount } from "@/lib/drive-accounts";
import { withTimeout, googleErrorMessage } from "@/lib/errors";
import { visibleFolderIds, loadFolders, fileOrClause, inScopeGoogleIds, isManager, accessContext, forbiddenTaggedFileIds, allBinnedIds } from "@/lib/visibility";
import { logAudit } from "@/lib/audit";
import { getProfile } from "@/lib/roles";
import { escapeLike } from "@/lib/http";
import { usernamesFor } from "@/lib/people";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").slice(0, 120);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(searchParams.get("offset") ?? 0) || 0, 0);
  // Append pages (infinite scroll) carry no live rows: live Google hits are
  // computed fresh per request and would re-arrive on every page, doubling
  // every file. Fresh (non-append) loads still merge them.
  const append = searchParams.get("append") === "1";
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
  // DEPARTMENT-TAG MODE: when the member's department matches an assigned tag,
  // only department content shows (own + tagged + dept folders); otherwise
  // everything shows by default (fallback).
  const accounts = await getAccounts() as (DriveAccount & { refresh_token: string })[];
  const labelOf = new Map(accounts.map((a) => [a.id, a.label]));
  const inactive = accounts.filter((a) => a.status !== "active").map((a) => a.id);
  const folders = await loadFolders(supa);
  // Tag tables are service-role-only (RLS deny-all): resolve access with admin.
  const adb = adminClient();
  const ctx = isManager(me.role) ? null : await accessContext(adb, me);
  const visible = ctx ? ctx.folders : visibleFolderIds(folders, me);
  const COLS = "id,name,mime,size,backends,owner,updated_at,folder,hash,storage_path,google_file_id,drive_account_id,google_parent_id";
  // NOTE: inactive-account and forbidden-tag exclusions are applied in JS
  // below, NOT as PostgREST NOT IN: `NOT IN` drops NULL drive_account_id rows
  // (SQL three-valued logic), which would hide legacy orphans from managers —
  // and thousand-id lists blow URL limits. The permission OR legs above are
  // safe server-side (they only widen to visible rows).
  const inactiveSet = new Set(inactive);
  const forbiddenSet = ctx ? new Set(await forbiddenTaggedFileIds(adb, me)) : new Set<string>();
  // Strict mode drops the commons leg: folderless rows only match when owned
  // or directly tagged (see fileOrClause).
  const strict = !!ctx?.strict;
  const orClause = fileOrClause(me, visible, ctx?.taggedFiles, strict);
  const buildQuery = (cols: string) => {
    let fq = supa.from("file_index").select(cols).ilike("name", `%${escapeLike(q)}%`);
    if (orClause) fq = fq.or(orClause);
    return fq;
  };
  // Hide pre-scope legacy rows (google rows with no account pin) from everyone
  // except managers, who need to see them to clean up. Counted separately so
  // the client can show the resync notice; dropped in JS below (a second OR
  // group can't ride the same PostgREST query as the permission legs).
  // Managers get their own count: those rows are VISIBLE to them, so their
  // notice says "clear them" (Storage → Resync clean + Sync) instead of "hidden".
  // Both counts are ZERO unless at least one drive is actually scoped: on an
  // unscoped (whole-drive) setup there is no "previous location", so there is
  // nothing to flag and nothing to clear.
  const scopedAny = accounts.some((a) => a.status === "active" && a.root_id);
  let hiddenLegacy = 0, orphanCount = 0;
  if (scopedAny) {
    const { count } = await supa.from("file_index").select("id", { count: "exact", head: true })
      .is("drive_account_id", null).not("google_file_id", "is", null);
    if (isManager(me.role)) orphanCount = count ?? 0;
    else hiddenLegacy = count ?? 0;
  }
  type Row = { id: string; name: string; mime: string; size: number; backends: string[]; drive_account_id?: string | null; google_file_id?: string | null; google_parent_id?: string | null };
  // Scope sets, resolved once: Google rows must sit inside their account's
  // scope (pre-scope leftovers hide). SCOPE APPLIES TO EVERY ROLE — including
  // admins. (Dept permission above is separate.)
  const allowed = new Set<string>();
  const unplaced = new Set<string>();
  const liveAccounts = accounts.filter((a) => a.status === "active" && a.root_id);
  for (const a of liveAccounts) {
    const scope = await inScopeGoogleIds(adb, a.id, a.root_id);
    if (scope) {
      for (const id of scope.ids) allowed.add(id);
      for (const id of scope.noparent) unplaced.add(id);
    }
  }
  const binned = await allBinnedIds(adb);
  const inScopeRow = (r: Row): boolean => {
    if (!r.google_file_id || !r.drive_account_id) return true;
    if (!liveAccounts.length) return true;
    // Placeless account rows (old mirrors with no recorded parent) stay
    // visible: account-confined, so they can't leak another drive's files.
    return allowed.has(r.google_file_id) || (r.google_parent_id == null && unplaced.has(r.google_file_id));
  };
  // Over-fetch loop: the DB page is wider than the filters (scope, legacy,
  // dedupe, bin all consume slots in memory), so a single .range() page can
  // come back short while more rows exist. Keep scanning until the page is
  // full or the DB is exhausted — otherwise infinite scroll silently drops
  // files and hasMore lies.
  const scoped: Row[] = [];
  const seenGoogle = new Map<string, number>(); // google id -> index in scoped
  let dbOffset = offset;
  let exhausted = false;
  // created_at arrives with migration 0018 — assume applied, drop back to the
  // old shape on the first created_at error (per page, until applied).
  let useCreatedAt = true;
  for (let page = 0; page < 6 && scoped.length < limit && !exhausted; page++) {
    // created_at arrives with migration 0018 — per page, retry without it
    // until applied. Other errors degrade to end-of-data (as before).
    let chunk: Row[];
    for (;;) {
      const fetched = await buildQuery(useCreatedAt ? `${COLS},created_at` : COLS).range(dbOffset, dbOffset + limit - 1);
      const rows = fetched.data;
      const rowsErr = (fetched as { error?: { message?: string } | null }).error;
      if (rowsErr && useCreatedAt && /created_at/.test(rowsErr.message ?? "")) { useCreatedAt = false; continue; }
      chunk = ((rows ?? []) as unknown as Row[]);
      break;
    }
    if (chunk.length < limit) exhausted = true;
    dbOffset += chunk.length;
    for (const r of chunk) {
      if (r.drive_account_id && inactiveSet.has(r.drive_account_id)) continue;
      if (forbiddenSet.has(r.id)) continue;
      if (!inScopeRow(r)) continue;
      // Pre-scope legacy rows (no account pin): invisible to non-managers.
      if (!isManager(me.role) && r.google_file_id && !r.drive_account_id) continue;
      if (binned.has(r.id)) continue;
      // One Drive file synced under two connected accounts owns one index row
      // PER account — collapse them so no file ever shows twice. Prefer the
      // account-pinned row: a legacy null-account duplicate must never win,
      // or members lose the file (legacy filter) while managers see a ghost.
      if (r.google_file_id) {
        const at = seenGoogle.get(r.google_file_id);
        if (at === undefined) { seenGoogle.set(r.google_file_id, scoped.length); scoped.push(r); continue; }
        if (!scoped[at].drive_account_id && r.drive_account_id) scoped[at] = r;
        continue;
      }
      scoped.push(r);
      if (scoped.length >= limit) break;
    }
    if (!chunk.length) break;
  }
  const hasMore = !exhausted;

  // 2) live Google fallback, across EVERY connected account — NEVER allowed to
  // 500 the route. A dead token or unreachable root degrades that account to
  // index-only + a reason string; other accounts still merge.
  // Skipped on append pages: live hits are recomputed per request and would
  // re-arrive on every page, doubling each file in infinite scroll.
  // Skipped in strict department-tag mode for members: unsynced live rows
  // carry no tags, so they are outside the department by definition.
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
  if (!append && !strict) {
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
  }
  if (errors.length) google_error = `${errors.join(" ")} Showing indexed files.`;
  const ownerNames = await usernamesFor(scoped.map((r) => (r as { owner?: string | null }).owner));
  const indexed = scoped.map((r: Row) => ({
    ...r,
    updated: (r as { updated_at?: string }).updated_at,
    owner_name: ownerNames.get((r as { owner?: string }).owner ?? "") ?? null,
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
  return Response.json({ q, results: merged, google: googleNote, google_error, hiddenLegacy, orphanCount, hasMore });
}
