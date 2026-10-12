export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { listDrivePage } from "@/lib/google-drive";
import { withTimeout, googleErrorMessage } from "@/lib/errors";
import { getAccounts, clientFor, type DriveAccount, activeDriveCheckEnabled, hasAnyAccountRows, driveBlockedResponse, requireActiveAccount } from "@/lib/drive-accounts";
import { inScopeGoogleIds, bustScopeCache } from "@/lib/visibility";

// Manager+: incremental Google → file_index sync (upsert by google_file_id).
// ONE page (≤200 files) per request PER ACCOUNT — the browser chains
// {accountId, nextPageToken} until every account reports done. Rows are pinned
// to their account (drive_account_id) so later ops use the right token.
const Body = z.object({ pageToken: z.string().max(20000).nullish(), accountId: z.string().uuid().nullish() });

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  let raw: unknown = {};
  try { raw = await req.json(); } catch { /* empty body → first page */ }
  const v = Body.safeParse(raw);
  if (!v.success) return Response.json({ error: "invalid request" }, { status: 400 });

  const accounts = await getAccounts() as (DriveAccount & { refresh_token: string })[];
  const live = accounts.filter((a) => a.status === "active");
  // Legacy fallback: no account rows yet but env token exists (pre-migration).
  // Dead unless active_drive_check is explicitly off: with the check on, zero
  // live accounts means every drive is deleted or disabled — fail closed with
  // the reason (404 vs 410) instead of syncing the env token's drive.
  if (!live.length) {
    if (await activeDriveCheckEnabled()) {
      if (await hasAnyAccountRows()) {
        return driveBlockedResponse({ error: "every connected drive is disabled — re-enable one in Storage to sync", code: "drive_disabled", status: 410 });
      }
      return driveBlockedResponse({ error: "no Google drive connected — connect one in Storage first", code: "drive_deleted", status: 404 });
    }
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      return Response.json({ error: "GOOGLE_REFRESH_TOKEN not set — run the /api/auth/google flow first (docs/10)." }, { status: 503 });
    }
    return legacySync(me.id, me.username, req, undefined, v.data.pageToken ?? undefined);
  }
  // Explicit pin: fresh fail-closed gate (404 deleted vs 410 disabled) —
  // never resolve a dead drive from the stale list cache.
  let acct: DriveAccount & { refresh_token: string };
  if (v.data.accountId) {
    const gate = await requireActiveAccount(v.data.accountId);
    if ("error" in gate) return driveBlockedResponse(gate);
    acct = gate.account;
  } else {
    acct = live[0];
  }

  let page;
  try {
    const d = clientFor(acct);
    if (!d) throw new Error("google not configured");
    page = await withTimeout(25_000, listDrivePage(v.data.pageToken ?? undefined, { drive: d, rootId: acct.root_id ?? "" }), `sync page (${acct.label})`);
  } catch (e) {
    return syncError(e);
  }
  const db = adminClient();
  const ids = page.files.map((f) => f.id).filter(Boolean) as string[];
  // Account-scoped match: the same Google id can be visible to two accounts
  // (shared files) — each account owns its own row (see 0011).
  const { data: existing } = await db.from("file_index").select("id,google_file_id,drive_account_id,backends")
    .eq("drive_account_id", acct.id).in("google_file_id", ids.length ? ids : ["__none__"]);
  const have = new Map((existing ?? []).map((r: { id: string; google_file_id: string; backends: string[] }) => [r.google_file_id, r]));
  let inserted = 0, updated = 0;
  for (const f of page.files) {
    if (!f.id) continue;
    const row = {
      name: f.name ?? "?", mime: f.mimeType ?? "application/octet-stream",
      size: Number(f.size ?? 0), google_file_id: f.id, drive_account_id: acct.id,
      // Schema holds ONE parent: multi-parent Drive files scope-check against
      // parents[0] only. A file whose first parent is out-of-scope but second
      // is in-scope hides until its in-scope parent is recorded (next sync
      // keeps the first stable parent it sees — no flapping, rare edge).
      google_parent_id: f.parents?.[0] ?? null
    };
    const ex = have.get(f.id);
    if (ex) {
      const backends = Array.from(new Set([...(ex.backends ?? []), "google"]));
      await db.from("file_index").update({ ...row, backends }).eq("id", ex.id);
      updated++;
    } else {
      const { error: insErr } = await db.from("file_index").insert({ ...row, backends: ["google"], owner: me.id });
      if (insErr) {
        // Lost a race with another page/account's insert — adopt nothing, skip.
        if (!/duplicate|unique/i.test(insErr.message)) throw new Error(insErr.message);
      } else inserted++;
    }
  }
  const done = !page.nextPageToken;
  // Tombstone sweep (account finished): Drive-deleted, Drive-trashed, and
  // moved-out-of-scope files never appear in the listing above, so upserts
  // alone leave them as live downloadable ghosts. Re-list Drive-side ids and
  // retire indexed rows that are in-scope but gone from Drive: pure Google
  // rows are deleted (audit detached, like purge), hybrids keep local bytes
  // with the google pin removed. Out-of-scope rows are NOT touched — they're
  // hidden by the listing, not dead. Bounded: 50 extra pages max.
  let sweptDeleted = 0, sweptUnpinned = 0;
  if (done) {
    try {
      const d = clientFor(acct);
      const seen = new Set<string>();
      if (d) {
        let tok: string | undefined;
        for (let i = 0; i < 50; i++) {
          const p = await withTimeout(25_000, listDrivePage(tok, { drive: d, rootId: acct.root_id ?? "" }), `sync sweep (${acct.label})`);
          for (const f of p.files) if (f.id) seen.add(f.id);
          tok = p.nextPageToken;
          if (!tok) break;
        }
      }
      const scope = acct.root_id ? await inScopeGoogleIds(db, acct.id, acct.root_id) : null;
      // App-trashed rows are trashed Drive-side too — sweeping them would
      // hard-delete Recovery Bin state. They stay until restore/purge.
      const binned = new Set<string>();
      for (let boff = 0; ; boff += 1000) {
        const { data: brows } = await db.from("recovery_bin").select("file_id").range(boff, boff + 999);
        const bchunk = ((brows ?? []) as { file_id: string }[]);
        for (const b of bchunk) binned.add(b.file_id);
        if (bchunk.length < 1000) break;
      }
      for (let off = 0; ; off += 500) {
        const { data: rows } = await db.from("file_index")
          .select("id,google_file_id,storage_path").eq("drive_account_id", acct.id).not("google_file_id", "is", null).range(off, off + 499);
        const chunk = ((rows ?? []) as { id: string; google_file_id: string; storage_path: string | null }[]);
        for (const r of chunk) {
          if (binned.has(r.id)) continue;
          // Only sweep rows that SHOULD be in the subtree: unscoped accounts
          // (scope null) sweep everything listed; scoped accounts sweep only
          // in-scope ids (out-of-scope rows are hidden, not dead).
          const shouldBeThere = !scope || scope.ids.has(r.google_file_id) || scope.noparent.has(r.google_file_id);
          if (!shouldBeThere || seen.has(r.google_file_id)) continue;
          if (r.storage_path) {
            await db.from("file_index").update({ google_file_id: null, google_parent_id: null, drive_account_id: null }).eq("id", r.id);
            sweptUnpinned++;
          } else {
            await db.from("recovery_bin").delete().eq("file_id", r.id);
            await db.from("approvals").delete().eq("file_id", r.id);
            await db.from("audit_logs").update({ file_id: null }).eq("file_id", r.id);
            await db.from("file_index").delete().eq("id", r.id);
            sweptDeleted++;
          }
        }
        if (chunk.length < 500) break;
      }
    } catch { /* sweep is best-effort: upserts already landed, counts report 0 */ }
    bustScopeCache(acct.id);
    await db.from("jobs").insert({ kind: "drive-sync", status: "done", payload: { by: me.username, account: acct.label, inserted, updated, sweptDeleted, sweptUnpinned } });
  }
  const nextAccount = done ? live[live.indexOf(acct) + 1]?.id ?? null : acct.id;
  return Response.json({
    ok: true, done: done && !nextAccount, accountId: acct.id, accountLabel: acct.label,
    nextAccountId: done ? nextAccount : acct.id,
    nextPageToken: page.nextPageToken ?? null, inserted, updated, sweptDeleted, sweptUnpinned, pageSize: ids.length
  });
}

function syncError(e: unknown) {
  const m = e instanceof Error ? e.message : "google request failed";
  return Response.json({ error: googleErrorMessage(m) }, { status: 502 });
}

// Pre-migration single-env sync (no account pinning).
async function legacySync(owner: string, username: string, req: Request, _acct: undefined, pageToken?: string) {
  const { listDrivePage: list } = await import("@/lib/google-drive");
  let page;
  try {
    page = await list(pageToken);
  } catch (e) {
    return syncError(e);
  }
  if (page.note === "google-not-configured") {
    return Response.json({ error: "GOOGLE_REFRESH_TOKEN not set — run the /api/auth/google flow first (docs/10)." }, { status: 503 });
  }
  const db = adminClient();
  const ids = page.files.map((f) => f.id).filter(Boolean) as string[];
  const { data: existing } = await db.from("file_index").select("id,google_file_id,backends").in("google_file_id", ids.length ? ids : ["__none__"]);
  const have = new Map((existing ?? []).map((r: { id: string; google_file_id: string; backends: string[] }) => [r.google_file_id, r]));
  let inserted = 0, updated = 0;
  for (const f of page.files) {
    if (!f.id) continue;
    const row = { name: f.name ?? "?", mime: f.mimeType ?? "application/octet-stream", size: Number(f.size ?? 0), google_file_id: f.id };
    const ex = have.get(f.id);
    if (ex) {
      const backends = Array.from(new Set([...(ex.backends ?? []), "google"]));
      await db.from("file_index").update({ ...row, backends }).eq("id", ex.id);
      updated++;
    } else {
      await db.from("file_index").insert({ ...row, backends: ["google"], owner });
      inserted++;
    }
  }
  const done = !page.nextPageToken;
  if (done) {
    await logAudit({ actor: owner, actor_name: username, action: "edit", req, detail: { sync: "google", inserted, updated } });
    await db.from("jobs").insert({ kind: "drive-sync", status: "done", payload: { by: username, inserted, updated } });
  }
  return Response.json({ ok: true, done, accountId: null, accountLabel: "Primary", nextAccountId: null, nextPageToken: page.nextPageToken ?? null, inserted, updated, pageSize: ids.length });
}
