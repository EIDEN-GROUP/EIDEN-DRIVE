export const dynamic = "force-dynamic";

import { getProfile } from "@/lib/roles";
import { getAccounts, quotaFor, rootKind, clientFor } from "@/lib/drive-accounts";

// Any signed-in user: drive labels + free space (powers the upload picker and
// Storage bars). No tokens ever leave the server.
export async function GET() {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const accounts = await getAccounts();
  const results = [];
  for (const a of accounts as (typeof accounts[number] & { refresh_token: string })[]) {
    let quota = { usage: null as number | null, limit: null as number | null, free: null as number | null, email: a.email };
    let rootKindName: string = a.status === "active" ? "mydrive" : "unknown";
    if (a.status === "active") {
      try {
        quota = await quotaFor(a);
        const d = clientFor(a);
        if (d) rootKindName = (await rootKind(d, a.root_id ?? "")).kind;
      } catch {
        rootKindName = "unreachable";
      }
    }
    results.push({
      id: a.id, label: a.label, email: quota.email ?? a.email,
      status: rootKindName === "unreachable" ? "down" : a.status,
      rootKind: rootKindName,
      usage: quota.usage, limit: quota.limit, free: quota.free
    });
  }
  return Response.json({ results });
}
