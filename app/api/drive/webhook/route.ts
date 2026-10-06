export const dynamic = "force-dynamic";

import { adminClient } from "@/lib/supabase-admin";
import { safeEqual } from "@/lib/http";

// Google Drive push notifications. Register the channel with `token: GOOGLE_WEBHOOK_TOKEN`;
// Google echoes it back in X-Goog-Channel-Token. Fails CLOSED if the secret is not configured.
export async function POST(req: Request) {
  const secret = process.env.GOOGLE_WEBHOOK_TOKEN;
  if (!secret) return Response.json({ error: "webhook not configured" }, { status: 503 });
  const given = req.headers.get("x-goog-channel-token") ?? "";
  if (!given || !safeEqual(given, secret)) return Response.json({ error: "bad channel token" }, { status: 401 });
  const channel = req.headers.get("x-goog-channel-id");
  if (!channel) return Response.json({ error: "no channel" }, { status: 400 });
  const state = req.headers.get("x-goog-resource-state") ?? "unknown";
  if (state === "sync") return Response.json({ ok: true, note: "channel established" }); // initial handshake, nothing to index
  await adminClient().from("jobs").insert({ kind: "drive-changes", status: "pending", payload: { channel, state } });
  return Response.json({ ok: true });
}
