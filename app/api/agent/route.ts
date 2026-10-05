import { createClient } from "@/lib/supabase-server";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";

// Agent-only: heartbeat + pull pending jobs. Auth via AGENT_TOKEN bearer.
export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.AGENT_TOKEN}`) {
    // Allow stub mode when token unset so UI can be demoed; deny in prod once set.
    if (process.env.AGENT_TOKEN) return Response.json({ error: "bad agent token" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as { hostname?: string; usb_used?: number; usb_total?: number };
  const supa = createClient();
  const { data: jobs } = await supa.from("jobs").select("*").eq("status", "pending").limit(10);
  await supa.from("jobs").insert({ kind: "agent-heartbeat", status: "done", payload: body });
  return Response.json({ ok: true, jobs: jobs ?? [], note: "agent executes allowlisted ops then POSTs /api/agent/complete" });
}

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "view", detail: { panel: "agent" } });
  const supa = createClient();
  const { data } = await supa.from("jobs").select("*").order("created_at", { ascending: false }).limit(20);
  return Response.json({ jobs: data ?? [] });
}
