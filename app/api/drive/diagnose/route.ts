export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { clientFor, getAccountFresh } from "@/lib/drive-accounts";
import { rootFor } from "@/lib/google-drive";
import { googleInScope, landedFileInScope, bustScopeCache } from "@/lib/visibility";
import { getAccounts } from "@/lib/drive-accounts";
import { parseQuery } from "@/lib/http";

const Q = z.object({ file_id: z.string().uuid() });

// Managers+: correlate one index row with live Drive truth. Answers "is this
// file's record stale, its drive dead, its scope wrong, or its bytes gone?"
// without serving any bytes. Built for upload post-mortems: given the failed
// upload's index row (or none), it shows the Google file ID, account, actual
// live parents, scope verdicts, and whether the Drive copy still exists —
// i.e. original-leftover vs duplicate-session is decidable from createdTime
// + parents + index presence.
export async function GET(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  const p = parseQuery(req, Q);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const { data: row } = await db.from("file_index")
    .select("id,name,mime,size,backends,owner,folder,storage_path,storage_bucket,google_file_id,google_parent_id,drive_account_id")
    .eq("id", p.data.file_id).maybeSingle();
  if (!row) return Response.json({ error: "no index row with that id", code: "no_row" }, { status: 404 });
  const f = row as {
    id: string; name: string; mime: string; size: number; google_file_id: string | null;
    google_parent_id: string | null; drive_account_id: string | null; storage_path: string | null;
  };
  const out: Record<string, unknown> = {
    row: { id: f.id, name: f.name, mime: f.mime, size: f.size, google_file_id: f.google_file_id, google_parent_id: f.google_parent_id, drive_account_id: f.drive_account_id, has_storage: !!f.storage_path },
  };
  if (!f.google_file_id) {
    out.live = null;
    out.verdict = "local-only row — no Google copy to correlate";
    return Response.json({ ok: true, ...out });
  }
  // Account truth, fresh (not cached): deleted vs disabled matters here.
  const acct = f.drive_account_id ? await getAccountFresh(f.drive_account_id) : null;
  out.account = f.drive_account_id
    ? { id: f.drive_account_id, status: acct?.status ?? "deleted", root_id: acct?.root_id ?? null, label: (acct as { label?: string } | null)?.label ?? null }
    : { id: null, status: "legacy-null-pin", root_id: null };
  if (!acct || acct.status !== "active") {
    out.live = null;
    out.verdict = !acct ? "drive row is gone (deleted) — live state unreachable through FileOS" : `drive is ${acct.status} — re-enable to re-check live state`;
    return Response.json({ ok: true, ...out });
  }
  const d = clientFor(acct);
  if (!d) return Response.json({ error: "google not configured", code: "google_failed" }, { status: 502 });
  let live: Record<string, unknown> | null = null;
  try {
    const meta = await d.files.get({
      fileId: f.google_file_id, fields: "id,name,mimeType,size,parents,driveId,trashed,createdTime,modifiedTime", supportsAllDrives: true,
    });
    live = (meta.data ?? {}) as Record<string, unknown>;
  } catch (e) {
    out.live = null;
    out.verdict = `Google copy unreachable (${e instanceof Error ? e.message.slice(0, 120) : "unknown"}) — deleted, unshared, or a wrong-account mapping`;
    return Response.json({ ok: true, ...out });
  }
  out.live = live;
  // Both scope verdicts side by side: indexed (legacy, row must exist in the
  // scope set) vs live-ancestry (correct for fresh/unindexed files).
  let root: { kind: "drive"; id: string } | { kind: "folder"; id: string } | { kind: "mydrive" };
  try {
    root = await rootFor(d, (acct as { root_id?: string | null }).root_id ?? "");
  } catch (e) {
    out.verdict = `scope root unresolvable: ${e instanceof Error ? e.message.slice(0, 140) : "unknown"}`;
    return Response.json({ ok: true, ...out });
  }
  out.root = root;
  const indexedVerdict = await googleInScope(db, await getAccounts(), f.drive_account_id, f.google_file_id);
  const liveVerdict = await landedFileInScope(d, root as never, {
    id: f.google_file_id, parents: (live.parents ?? []) as string[], driveId: live.driveId as string | undefined,
  });
  out.scope = { indexed_verdict: indexedVerdict, live_verdict: liveVerdict };
  // Fresh bust so the next listing re-derives scope instead of reusing a
  // set cached before a re-scope.
  bustScopeCache(f.drive_account_id ?? undefined);
  const parents = (live.parents ?? []) as string[];
  const indexedParent = f.google_parent_id;
  out.verdict =
    live.trashed ? "Google copy is TRASHED — restore it in Drive or purge the row"
    : !liveVerdict.ok ? `OUT OF SCOPE live (${(liveVerdict as { reason: string }).reason}) — row is stale or the file was moved in Drive; resync-clean + Sync`
    : indexedParent && parents.length && indexedParent !== parents[0] ? `moved in Drive (index says parent ${indexedParent}, live says ${parents[0]}) — Sync to reconcile`
    : !indexedVerdict ? "live file is in scope but the INDEX verdict disagrees — stale scope cache or pre-scope row; busted cache, re-check the listing"
    : "healthy: indexed row, live copy, and scope agree";
  return Response.json({ ok: true, ...out });
}
