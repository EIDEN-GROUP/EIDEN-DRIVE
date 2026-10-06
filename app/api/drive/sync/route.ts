export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { listDrivePage } from "@/lib/google-drive";

// Manager+: incremental Google → file_index sync (upsert by google_file_id).
// ONE page (≤200 files) per request — the browser chains `nextPageToken` until
// `done:true`. A single request that walks a whole drive exceeds the Vercel
// serverless timeout and surfaces as HTTP 502; chunking removes that entirely.
const Body = z.object({ pageToken: z.string().max(2000).nullish() });

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  // Tolerate empty bodies (older clients / curl with no -d): default to first page.
  let raw: unknown = {};
  try { raw = await req.json(); } catch { /* empty body → first page */ }
  const v = Body.safeParse(raw);
  if (!v.success) return Response.json({ error: "invalid request" }, { status: 400 });
  let page;
  try {
    page = await listDrivePage(v.data.pageToken ?? undefined);
  } catch (e) {
    const m = e instanceof Error ? e.message : "google request failed";
    if (/invalid_grant/i.test(m)) {
      return Response.json({ error: "Google rejected the refresh token — re-run /api/auth/google as admin, save the new token, redeploy." }, { status: 502 });
    }
    if (/not.?found|404/i.test(m)) {
      return Response.json({ error: "Shared Drive not found or not shared with the connected Google account — check GOOGLE_SHARED_DRIVE_ID and share the drive with fileos@eiden-group.com." }, { status: 502 });
    }
    return Response.json({ error: `Google Drive unreachable right now (${m}).` }, { status: 502 });
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
    const row = {
      name: f.name ?? "?", mime: f.mimeType ?? "application/octet-stream",
      size: Number(f.size ?? 0), google_file_id: f.id
    };
    const ex = have.get(f.id);
    if (ex) {
      const backends = Array.from(new Set([...(ex.backends ?? []), "google"]));
      await db.from("file_index").update({ ...row, backends }).eq("id", ex.id);
      updated++;
    } else {
      await db.from("file_index").insert({ ...row, backends: ["google"], owner: me.id });
      inserted++;
    }
  }
  const done = !page.nextPageToken;
  if (done) {
    await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { sync: "google", inserted, updated, pages: "chained" } });
    await db.from("jobs").insert({ kind: "drive-sync", status: "done", payload: { by: me.username, inserted, updated } });
  }
  return Response.json({ ok: true, done, nextPageToken: page.nextPageToken ?? null, inserted, updated, pageSize: ids.length });
}
