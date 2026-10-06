export const dynamic = "force-dynamic";

import { adminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { listAllDriveFiles } from "@/lib/google-drive";

// Manager+: pull EVERYTHING from Google into file_index (upsert by google_file_id).
// This is what makes Drive "pull all the data from Google" instead of the top-10 live fallback.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me || !can(me.role, "manage-users")) return Response.json({ error: "managers only" }, { status: 403 });
  let files: { id?: string | null; name?: string | null; mimeType?: string | null; size?: string | null }[];
  try {
    ({ files } = await listAllDriveFiles());
  } catch (e) {
    const m = e instanceof Error ? e.message : "google request failed";
    if (/invalid_grant/i.test(m)) {
      return Response.json({ error: "Google rejected the refresh token — re-run /api/auth/google as admin, save the new token, redeploy." }, { status: 502 });
    }
    return Response.json({ error: `Google Drive unreachable right now (${m}).` }, { status: 502 });
  }
  if (!files.length) {
    return Response.json({ error: "GOOGLE_REFRESH_TOKEN not set — run the /api/auth/google flow first (docs/10)." }, { status: 503 });
  }
  const db = adminClient();
  const ids = files.map((f) => f.id).filter(Boolean) as string[];
  const { data: existing } = await db.from("file_index").select("id,google_file_id,backends").in("google_file_id", ids.length ? ids : ["__none__"]);
  const have = new Map((existing ?? []).map((r: { id: string; google_file_id: string; backends: string[] }) => [r.google_file_id, r]));
  let inserted = 0, updated = 0;
  for (const f of files) {
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
  await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { sync: "google", inserted, updated } });
  await db.from("jobs").insert({ kind: "drive-sync", status: "done", payload: { by: me.username, inserted, updated } });
  return Response.json({ ok: true, inserted, updated, total: files.length });
}
