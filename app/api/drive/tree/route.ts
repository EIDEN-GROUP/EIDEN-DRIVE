export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { getAccounts, type DriveAccount } from "@/lib/drive-accounts";
import { parseQuery } from "@/lib/http";

const Q = z.object({ accountId: z.string().uuid() });

// Full Google tree for one ACTIVE account (folders AND files, capped) so the
// Explorer can render drives > folders > files from the index. Disabled drives
// are invisible here too.
export async function GET(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = parseQuery(req, Q);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ error: "server not configured" }, { status: 503 });
  const accounts = await getAccounts() as (DriveAccount & { refresh_token: string })[];
  const acct = accounts.find((a) => a.id === p.data.accountId);
  if (!acct || acct.status !== "active") return Response.json({ error: "drive not available" }, { status: 404 });
  const db = adminClient();
  const { data, error } = await db.from("file_index")
    .select("id,name,mime,size,google_file_id,google_parent_id,backends")
    .eq("drive_account_id", p.data.accountId)
    .not("google_file_id", "is", null)
    .order("name")
    .limit(2000);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  // The client scopes the tree top to this root: children of rootId only.
  // (parent-less legacy rows predate scoping — resync-clean removes them.)
  return Response.json({ results: data ?? [], rootId: acct.root_id ?? null });
}
