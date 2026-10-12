import { adminClient, hasAdminClient } from "@/lib/supabase-admin";

/** id → username for the given profile ids (nulls/duplicates ignored). Empty map when unconfigured. */
export async function usernamesFor(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean) as string[]));
  if (!uniq.length || !hasAdminClient()) return new Map();
  const { data } = await adminClient().from("profiles").select("id,username").in("id", uniq.slice(0, 500));
  return new Map(((data ?? []) as { id: string; username: string }[]).map((p) => [p.id, p.username]));
}
