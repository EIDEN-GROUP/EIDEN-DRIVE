export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { parseJson } from "@/lib/http";

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  message: z.string().trim().max(500).optional().default("")
});

// Public: the login page's "Request access" form. Anyone can ask; managers triage.
// One pending request per email (re-asks refresh the row). Never reveals whether an
// account already exists — always the same success message.
export async function POST(req: Request) {
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const db = adminClient();
  const { name, email, message } = p.data;
  const { data: dup } = await db.from("access_requests").select("id").eq("email", email).eq("status", "pending").maybeSingle();
  if (dup) {
    await db.from("access_requests").update({ name, message }).eq("id", dup.id);
  } else {
    const { error } = await db.from("access_requests").insert({ name, email, message });
    if (error) return Response.json({ error: "couldn't save the request" }, { status: 500 });
  }
  // Ping every manager/admin through the notifications table (best effort).
  const { data: mgrs } = await db.from("profiles").select("id").in("role", ["admin", "manager"]).limit(50);
  if (mgrs && mgrs.length) {
    await db.from("notifications").insert(
      mgrs.map((m: { id: string }) => ({ user_id: m.id, kind: "approval-pending", title: "Access request", body: `${name} <${email}> asked for an account.` }))
    );
  }
  return Response.json({ ok: true }, { status: 201 });
}
