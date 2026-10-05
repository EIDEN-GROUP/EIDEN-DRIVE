import { createClient } from "@/lib/supabase-server";
import { listDriveFiles } from "@/lib/google-drive";
import { logAudit } from "@/lib/audit";
import { getProfile } from "@/lib/roles";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const supa = createClient();
  const me = await getProfile();

  // 1) indexed files (Google + Local + Backup badges)
  const { data: rows } = await supa.from("file_index").select("id,name,mime,size,backends,owner,updated_at").ilike("name", `%${q}%`).limit(50);
  // 2) live Google fallback
  const g = await listDriveFiles(q);
  const merged = [
    ...(rows ?? []).map((r: { id: string; name: string; mime: string; size: number; backends: string[] }) => ({ ...r, updated: r && (r as { updated_at?: string }).updated_at }),
    ...(g.files ?? []).slice(0, 10).map((f: { id?: string; name?: string; mimeType?: string; size?: string }) => ({
      id: `g:${f.id}`, name: f.name ?? "?", mime: f.mimeType, size: Number(f.size ?? 0), backends: ["google"]
    }))
  ];

  if (me) await logAudit({ actor: me.id, actor_name: me.username, action: "view", req, detail: { q } });
  return Response.json({ q, results: merged, google: (g as { note?: string }).note ?? "ok" });
}
