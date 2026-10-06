export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { listDriveFiles } from "@/lib/google-drive";
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
  const { data: rows } = await supa.from("file_index").select("id,name,mime,size,backends,owner,updated_at,folder,hash,storage_path,google_file_id").ilike("name", `%${escapeLike(q)}%`).range(offset, offset + limit - 1);

  // 2) live Google fallback — NEVER allowed to 500 the route. A bad/expired refresh
  // token, revoked access, or Google outage degrades to index-only + a reason string.
  let g: { files?: { id?: string | null; name?: string | null; mimeType?: string | null; size?: string | null }[]; note?: string } = { files: [] };
  let google_error: string | null = null;
  try {
    g = await listDriveFiles(q);
  } catch (e) {
    const m = e instanceof Error ? e.message : "google request failed";
    google_error = /invalid_grant/i.test(m)
      ? "Google rejected the refresh token — re-run /api/auth/google as admin, save the new token, redeploy."
      : /not.?found|404/i.test(m)
        ? "Google can't open the configured Drive ID — it must be a Shared Drive (shared with the connected account) or a My Drive folder ID. See /api/health for the connected account. Showing indexed files."
        : `Google Drive unreachable right now (${m}). Showing indexed files.`;
  }
  const indexed = (rows ?? []).map((r: { id: string; name: string; mime: string; size: number; backends: string[] }) => ({ ...r, updated: (r as { updated_at?: string }).updated_at }));
  const live = (g.files ?? []).slice(0, 10).map((f: { id?: string | null; name?: string | null; mimeType?: string | null; size?: string | null }) => ({
    id: `g:${f.id}`, name: f.name ?? "?", mime: f.mimeType ?? undefined, size: Number(f.size ?? 0), backends: ["google"]
  }));
  const merged = [...indexed, ...live];

  await logAudit({ actor: me.id, actor_name: me.username, action: "view", req, detail: { q } });
  return Response.json({ q, results: merged, google: (g as { note?: string }).note ?? "ok", google_error });
}
