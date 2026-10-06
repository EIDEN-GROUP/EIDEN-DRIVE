export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { parseJson } from "@/lib/http";

const Row = z.object({
  id: z.string(), title: z.string(), detail: z.string().nullable().optional(),
  plan_date: z.string(), plan_time: z.string().nullable().optional(),
  priority: z.string(), folder: z.string().nullable().optional(),
  done: z.boolean(), created_at: z.string()
});
export type PlanRow = z.infer<typeof Row>;

// Own plans for the calendar (any role — plans are personal).
export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = adminClient();
  const { data } = await db.from("plans").select("id,title,detail,plan_date,plan_time,priority,folder,done,created_at")
    .eq("owner", me.id).order("plan_date", { ascending: true }).limit(500);
  return Response.json({ results: data ?? [] });
}

const Create = z.object({
  title: z.string().trim().min(1).max(160),
  detail: z.string().max(2000).nullable().optional(),
  plan_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  plan_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  folder: z.string().uuid().nullable().optional()
});

export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Create);
  if (p.error) return p.error;
  const db = adminClient();
  if (p.data.folder) {
    const { data: f } = await db.from("folders").select("id").eq("id", p.data.folder).maybeSingle();
    if (!f) return Response.json({ error: "folder not found" }, { status: 404 });
  }
  const { data, error } = await db.from("plans").insert({
    owner: me.id, title: p.data.title, detail: p.data.detail ?? null,
    plan_date: p.data.plan_date, plan_time: p.data.plan_time ?? null,
    priority: p.data.priority, folder: p.data.folder ?? null
  }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, id: data.id });
}

const Update = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
  detail: z.string().max(2000).nullable().optional(),
  plan_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  plan_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  folder: z.string().uuid().nullable().optional(),
  done: z.boolean().optional()
});

export async function PATCH(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Update);
  if (p.error) return p.error;
  const { id, ...patch } = p.data;
  const db = adminClient();
  const { error } = await db.from("plans").update(patch).eq("id", id).eq("owner", me.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

const Remove = z.object({ id: z.string().uuid() });

export async function DELETE(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Remove);
  if (p.error) return p.error;
  const db = adminClient();
  const { error } = await db.from("plans").delete().eq("id", p.data.id).eq("owner", me.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
