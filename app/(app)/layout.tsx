import AppShell from "@/components/shell/AppShell";
import { getProfile } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getProfile();
  return (
    <AppShell user={me ? { username: me.username, role: me.role, dept: me.department_tag } : null}>
      {children}
    </AppShell>
  );
}
