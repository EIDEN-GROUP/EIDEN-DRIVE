export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { getProfile } from "@/lib/roles";

export async function GET() {
  if (!(await getProfile())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const supa = createClient();
  const { data } = await supa.from("audit_logs").select("*").order("ts", { ascending: false }).limit(100);
  return Response.json({ results: data ?? [] });
}
