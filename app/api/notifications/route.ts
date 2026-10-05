import { createClient } from "@/lib/supabase-server";
import { getProfile } from "@/lib/roles";

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supa = createClient();
  const { data } = await supa.from("notifications").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(30);
  return Response.json({ results: data ?? [] });
}
