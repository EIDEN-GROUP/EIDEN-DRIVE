export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { listDriveFiles } from "@/lib/google-drive";
import { getAccounts, clientFor, type DriveAccount } from "@/lib/drive-accounts";
import { withTimeout, googleErrorMessage } from "@/lib/errors";
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
  const accounts = await getAccounts() as (DriveAccount & { refresh_token: string })[];
  const labelOf = new Map(accounts.map((a) => [a.id, a.label]));
  const inactive = accounts.filter((a) => a.status !== "active").map((a) => a.id);
  let filesQuery = supa.from("file_index").select("id,name,mime,size,backends,owner,updated_at,folder,hash,storage_path,google_file_id,drive_account_id,google_parent_id").ilike("name", `%${escapeLike(q)}%`);
  if (inactive.length) filesQuery = filesQuery.not("drive_account_id", "in", `(${inactive.join(",")})`);
  const { data: rows } = await filesQuery.range(offset, offset + limit - 1);

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
  const indexed = (rows ?? []).map((r: { id: string; name: string; mime: string; size: number; backends: string[]; drive_account_id?: string | null }) => ({
    ...r,
    updated: (r as { updated_at?: string }).updated_at,
    accountLabel: r.drive_account_id ? labelOf.get(r.drive_account_id) ?? undefined : undefined
  }));
  const merged = [...indexed, ...live];

  await logAudit({ actor: me.id, actor_name: me.username, action: "view", req, detail: { q } });
  return Response.json({ q, results: merged, google: googleNote, google_error });
}
