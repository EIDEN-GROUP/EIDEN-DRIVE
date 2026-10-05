import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supa = createClient();
  const { data } = await supa.from("audit_logs").select("*").order("ts", { ascending: false }).limit(100);
  return Response.json({ results: data ?? [] });
}
