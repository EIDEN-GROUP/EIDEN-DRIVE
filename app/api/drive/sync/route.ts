export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { listDrivePage } from "@/lib/google-drive";
import { getAccounts, clientFor, type DriveAccount } from "@/lib/drive-accounts";

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
  if (!live.length) {
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      return Response.json({ error: "GOOGLE_REFRESH_TOKEN not set — run the /api/auth/google flow first (docs/10)." }, { status: 503 });
    }
    return legacySync(me.id, me.username, req, undefined, v.data.pageToken ?? undefined);
  }
  const acct = v.data.accountId ? live.find((a) => a.id === v.data.accountId) : live[0];
  if (!acct) return Response.json({ error: "drive account not found" }, { status: 404 });

  let page;
  try {
    const d = clientFor(acct);
    if (!d) throw new Error("google not configured");
    page = await listDrivePage(v.data.pageToken ?? undefined, { drive: d, rootId: acct.root_id ?? "" });
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
  if (done) {
    await db.from("jobs").insert({ kind: "drive-sync", status: "done", payload: { by: me.username, account: acct.label, inserted, updated } });
  }
  const nextAccount = done ? live[live.indexOf(acct) + 1]?.id ?? null : acct.id;
  return Response.json({
    ok: true, done: done && !nextAccount, accountId: acct.id, accountLabel: acct.label,
    nextAccountId: done ? nextAccount : acct.id,
    nextPageToken: page.nextPageToken ?? null, inserted, updated, pageSize: ids.length
  });
}

function syncError(e: unknown) {
  const m = e instanceof Error ? e.message : "google request failed";
  if (/invalid_grant/i.test(m)) {
    return Response.json({ error: "Google rejected a refresh token — reconnect that account from /api/auth/google?label=… (same Gmail refreshes its token)." }, { status: 502 });
  }
  if (/not.?found|404/i.test(m)) {
    return Response.json({ error: "Google can't open that root — check the account's root folder/drive and /api/health to see which account is connected." }, { status: 502 });
  }
  return Response.json({ error: `Google Drive unreachable right now (${m}).` }, { status: 502 });
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
