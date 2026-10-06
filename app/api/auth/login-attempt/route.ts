export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { parseJson } from "@/lib/http";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  reason: z.string().max(120).optional().default("")
});

// Public: login page reports failed attempts (fire-and-forget). Throttled in-memory
// per IP so it can't be used to flood the table. Reads are service-role only.
const hits = new Map<string, number>();
function throttled(ip: string): boolean {
  const now = Date.now();
  for (const [k, t] of hits) if (now - t > 60000) hits.delete(k);
  if (hits.has(ip)) return true;
  hits.set(ip, now);
  return false;
}

export async function POST(req: Request) {
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ ok: true });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (throttled(`${ip}:${p.data.email}`)) return Response.json({ ok: true });
  await adminClient().from("login_attempts").insert({ email: p.data.email, ip, reason: p.data.reason });
  return Response.json({ ok: true }, { status: 201 });
}
