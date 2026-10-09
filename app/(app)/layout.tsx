import AppShell from "@/components/shell/AppShell";
import { getProfile } from "@/lib/roles";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { avatarUrlFor } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getProfile();
  // Avatar for the navbar: signed fresh per navigation (5-min URLs can't be cached).
  let avatarUrl: string | null = null;
  if (me && hasAdminClient()) {
    try {
      const { data: p } = await adminClient().from("profiles").select("avatar_path").eq("id", me.id).maybeSingle();
      const path = (p as { avatar_path?: string | null } | null)?.avatar_path;
      if (path) avatarUrl = await avatarUrlFor(path);
    } catch { /* navbar falls back to the initial */ }
  }
  return (
    <AppShell user={me ? { username: me.username, role: me.role, dept: me.department_tag, avatarUrl } : null}>
      {children}
    </AppShell>
  );
}
