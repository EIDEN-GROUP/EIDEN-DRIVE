import "server-only";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS. SERVER ONLY — used for audit writes, agent/webhook jobs,
// vault auth state, notifications and profile changes AFTER the route has done its own role check.
// Untyped on purpose: the project has no generated DB types yet (`npm run db:types`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;
let cached: Db | null = null;

export function adminClient(): Db {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not set");
  if (!cached) cached = createSb(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as Db;
  return cached;
}

export function hasAdminClient(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}
