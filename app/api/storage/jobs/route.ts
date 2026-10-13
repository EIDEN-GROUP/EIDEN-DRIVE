export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile, can } from "@/lib/roles";
import { parseQuery } from "@/lib/http";

const Q = z.object({
  // Opaque keyset cursor from the previous page (base64url of {ts,id}).
  // Absent = first page. Cursor pagination (not offsets): rows inserted
  // between pages neither duplicate nor skip — order is stable.
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

interface Cursor { ts: string; id: string }

function decodeCursor(raw: string): Cursor | null {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString()) as Partial<Cursor>;
    if (typeof c.ts !== "string" || typeof c.id !== "string") return null;
    if (Number.isNaN(new Date(c.ts).getTime())) return null;
    return { ts: c.ts, id: c.id };
  } catch {
    return null;
  }
}

function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify({ ts, id })).toString("base64url");
}

type Job = { id: string; kind: string; status?: string | null; created_at: string; payload?: Record<string, unknown> | null };

// Backup history, newest first, genuinely paginated: each request fetches at
// most `limit` rows (+1 probe for hasMore), never the whole table. Dedicated
// endpoint so /api/storage (drives, KPIs, agent heartbeat, USB list) is
// untouched. Heartbeats are NOT backup history — kind stays backup% only.
// Admin-only (agent download URLs ride in payloads): the Storage Backups
// panel is the only caller.
export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!can(me.role, "admin-only")) return Response.json({ error: "admins only", code: "forbidden" }, { status: 403 });
  const p = parseQuery(req, Q);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });

  let cur: Cursor | null = null;
  if (p.data.cursor !== undefined) {
    cur = decodeCursor(p.data.cursor);
    if (!cur) return Response.json({ error: "bad cursor — reload the list from the top", code: "bad_cursor" }, { status: 400 });
  }

  const db = adminClient();
  let q = db.from("jobs").select("id,kind,status,created_at,payload").ilike("kind", "backup%");
  // Keyset: strictly older than the cursor, with id tiebreak for identical
  // timestamps. New rows inserted mid-scroll appear on EARLIER pages only —
  // already-served pages never shift, so nothing duplicates or skips.
  if (cur) {
    q = q.or(`and(created_at.lt.${cur.ts}),and(created_at.eq.${cur.ts},id.lt.${cur.id})`);
  }
  const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(p.data.limit + 1);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = ((data ?? []) as Job[]).slice(0, p.data.limit);
  const hasMore = (data ?? []).length > p.data.limit;
  const last = rows[rows.length - 1] ?? null;

  // Admin-only endpoint: payloads (agent download URLs) go through unscrubbed.
  const jobs = rows.map((j) => j);

  return Response.json({
    ok: true,
    jobs,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  });
}
