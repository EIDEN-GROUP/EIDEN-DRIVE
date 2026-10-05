import { createClient } from "@/lib/supabase-server";
import { Card, Pill } from "@/components/ui/primitives";

export default async function UsersPage() {
  const supa = createClient();
  const { data } = await supa.from("profiles").select("username,role,department_tag").order("username").limit(100);
  return (
    <section>
      <h1 className="font-display text-3xl uppercase mb-3">Users & Departments</h1>
      <Card label="Members — tags assigned by Manager/Admin only">
        <ul className="text-sm mt-1">
          {(data ?? []).map((u: { username: string; role: string; department_tag: string | null }) => (
            <li key={u.username} className="py-1 border-b flex gap-2 items-center">{u.username} <Pill>{u.role}</Pill> {u.department_tag && <Pill tone="fill">{u.department_tag}</Pill>}</li>
          ))}
          {(!data || data.length === 0) && <li className="font-serif italic">Seed: Oualid (admin · all) · Hassan (design) · Abdelhakim (web) · Aya (manual) — assign tags after login.</li>}
        </ul>
      </Card>
    </section>
  );
}
