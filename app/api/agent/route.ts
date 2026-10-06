export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { safeEqual } from "@/lib/http";

// Agent-only: heartbeat + pull pending jobs. Auth via AGENT_TOKEN bearer. Fails CLOSED if the token is not configured.
export async function POST(req: Request) {
  const token = process.env.AGENT_TOKEN;
  if (!token) return Response.json({ error: "agent endpoint not configured" }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !safeEqual(given, token)) return Response.json({ error: "bad agent token" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { hostname?: string; usb_used?: number; usb_total?: number };
  const supa = adminClient();
  const { data: jobs } = await supa.from("jobs").select("*").eq("status", "pending").limit(10);
  await supa.from("jobs").insert({ kind: "agent-heartbeat", status: "done", payload: { hostname: body.hostname ?? null, usb_used: body.usb_used ?? null, usb_total: body.usb_total ?? null } });
  return Response.json({ ok: true, jobs: jobs ?? [], note: "agent executes allowlisted ops then reports back" });
}

export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (me.role === "member") return Response.json({ error: "managers only" }, { status: 403 });
  await logAudit({ actor: me.id, actor_name: me.username, action: "view", detail: { panel: "agent" } });
  const supa = createClient();
  const { data } = await supa.from("jobs").select("*").order("created_at", { ascending: false }).limit(20);
  return Response.json({ jobs: data ?? [] });
}
