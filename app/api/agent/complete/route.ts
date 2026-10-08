export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { logAudit } from "@/lib/audit";
import { safeEqual, parseJson } from "@/lib/http";
import { USB_JOB } from "@/lib/usb";

const Body = z.object({
  job_id: z.string().uuid(),
  ok: z.boolean(),
  error: z.string().max(300).optional(),
  bytes: z.number().int().nonnegative().optional()
});

// Agent-only (AGENT_TOKEN bearer): report a pulled job's outcome. For a
// completed usb-upload the file earns its "usb" backend pin.
export async function POST(req: Request) {
  const token = process.env.AGENT_TOKEN;
  if (!token) return Response.json({ error: "agent endpoint not configured" }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !safeEqual(given, token)) return Response.json({ error: "bad agent token" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const db = adminClient();
  const { data: job } = await db.from("jobs").select("id,kind,status,payload").eq("id", p.data.job_id).maybeSingle();
  const j = job as { id: string; kind: string; status: string; payload: { file_id?: string; by?: string; owner?: string } | null } | null;
  if (!j || j.status !== "pending") return Response.json({ error: "job not found or not pending" }, { status: 404 });
  await db.from("jobs").update({
    status: p.data.ok ? "done" : "failed",
    payload: { ...(j.payload ?? {}), result: p.data.ok ? "ok" : "failed", error: p.data.error ?? null, bytes: p.data.bytes ?? null }
  }).eq("id", j.id);
  if (p.data.ok && j.kind === USB_JOB && j.payload?.file_id) {
    const { data: f } = await db.from("file_index").select("id,backends").eq("id", j.payload.file_id).maybeSingle();
    const row = f as { id: string; backends: string[] } | null;
    if (row && !row.backends.includes("usb")) {
      await db.from("file_index").update({ backends: [...row.backends, "usb"] }).eq("id", row.id);
    }
    await logAudit({ actor: j.payload.owner as string ?? "agent", actor_name: `agent:${j.payload.by ?? "office-pc"}`, action: "backup", file_id: row?.id ?? j.payload.file_id, req, detail: { usb_job: j.id, bytes: p.data.bytes ?? null } });
  }
  return Response.json({ ok: true });
}
