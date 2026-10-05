import { createClient } from "@/lib/supabase-server";
import { Card, Pill } from "@/components/ui/primitives";
import { classify, formatBytes, badge } from "@/lib/files";

export default async function FilePage({ params }: { params: { id: string } }) {
  const supa = createClient();
  const { data: f } = await supa.from("file_index").select("*").eq("id", params.id).single();
  const { data: vers } = await supa.from("versions").select("*").eq("file_id", params.id).order("v", { ascending: false }).limit(10);
  const { data: acts } = await supa.from("audit_logs").select("*").eq("file_id", params.id).order("ts", { ascending: false }).limit(20);

  if (!f) return <section><h1 className="font-display text-3xl">Not found</h1><p className="text-sm">No indexed file with id {params.id}.</p></section>;

  return (
    <section className="grid md:grid-cols-[1fr_320px] gap-4">
      <Card label={`${classify(f.name, f.mime)} · ${formatBytes(f.size)}`}>
        <h1 className="font-display text-3xl mt-1">{f.name}</h1>
        <p className="text-sm mt-1">{badge(f.backends ?? ["google"])} · SHA {String(f.hash ?? "").slice(0, 12) || "—"}</p>
        <div className="mt-3 flex gap-2 flex-wrap">
          <Pill>Preview (PDF.js / Google viewer wired in P2)</Pill>
          <form action="/api/drive/trash" method="post"><button className="underline text-xs min-h-[44px] px-2" formAction="/api/drive/trash">Move to Recovery Bin</button></form>
        </div>
      </Card>
      <div className="flex flex-col gap-4">
        <Card label="Versions">
          <ul className="text-sm">{(vers ?? []).map((v: { v: number; hash: string }) => <li key={v.v}>v{v.v} · {String(v.hash).slice(0, 10)}</li>)}{(!vers || vers.length === 0) && <li className="font-serif italic">v17 … v1 tracked on edit.</li>}</ul>
        </Card>
        <Card label="Activity">
          <ul className="text-sm">{(acts ?? []).map((a: { id: string; actor_name: string; action: string; ts: string }) => <li key={a.id}>{a.actor_name} · {a.action} · {a.ts}</li>)}{(!acts || acts.length === 0) && <li className="font-serif italic">Aya edited 11:04 · Basma viewed 11:23 · System backed up 11:25</li>}</ul>
        </Card>
      </div>
    </section>
  );
}
