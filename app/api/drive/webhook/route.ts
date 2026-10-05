export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase-server";

// Drive change webhook (Google push notifications). Verifies channel headers, enqueues reindex job.
export async function POST(req: Request) {
  const channel = req.headers.get("x-goog-channel-id");
  if (!channel) return Response.json({ error: "no channel" }, { status: 400 });
  const supa = createClient();
  await supa.from("jobs").insert({ kind: "drive-changes", status: "pending", payload: { channel } });
  return Response.json({ ok: true });
}
