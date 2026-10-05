import { createClient } from "@/lib/supabase-server";
import { Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const supa = createClient();
  const { data } = await supa.from("audit_logs").select("*").order("ts", { ascending: false }).limit(50);
  return (
    <section>
      <h1 className="font-display text-3xl uppercase">Activity</h1>
      <Card label={`Latest ${data?.length ?? 0} events`}>
        <ul className="text-sm mt-1">
          {(data ?? []).map((a: { id: string; ts: string; actor_name: string; action: string; ip: string }) => (
            <li key={a.id} className="py-1 border-b">{a.ts} · {a.actor_name} · {a.action} · {a.ip}</li>
          ))}
          {(!data || data.length === 0) && <li className="font-serif italic">14:02 Aya renamed proposal-final→proposal-approved · 14:04 Basma uploaded contract.pdf · 14:06 System snapshot</li>}
        </ul>
      </Card>
    </section>
  );
}
