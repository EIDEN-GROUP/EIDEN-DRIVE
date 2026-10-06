import { createClient } from "@/lib/supabase-server";
import { Card } from "@/components/ui/primitives";
import { classify, formatBytes, badge } from "@/lib/files";
import FileActions from "@/components/drive/FileActions";

export const dynamic = "force-dynamic";

export default async function FilePage({ params }: { params: { id: string } }) {
  const supa = createClient();
  const { data: f } = await supa.from("file_index").select("*").eq("id", params.id).maybeSingle();
  if (!f) {
    return (
      <section className="px-1 pt-1">
        <h1 className="page-title">File not found</h1>
        <p className="text-sm text-muted mt-1">It may have been trashed or you followed a stale link.</p>
        <a href="/drive" className="mt-4 inline-block min-h-[44px] px-5 leading-[44px] rounded-md bg-brand text-white text-sm font-medium">Back to Drive</a>
      </section>
    );
  }
  const { data: vers } = await supa.from("versions").select("v,hash").eq("file_id", params.id).order("v", { ascending: false }).limit(10);
  const { data: acts } = await supa.from("audit_logs").select("id,actor_name,action,ts").eq("file_id", params.id).order("ts", { ascending: false }).limit(20);

  return (
    <section className="grid md:grid-cols-[1fr_320px] gap-4 px-1 pt-1 items-start">
      <Card label={`${classify(f.name, f.mime)} · ${formatBytes(f.size)}`}>
        <h1 className="page-title mt-1 break-all">{f.name}</h1>
        <p className="text-sm mt-1 text-muted">{badge(f.backends ?? ["google"])} · SHA {String(f.hash ?? "").slice(0, 12) || "—"}</p>
        <FileActions id={f.id} name={f.name} googleId={f.google_file_id} downloadable={!!f.storage_path} />
      </Card>
      <div className="flex flex-col gap-4">
        <Card label={`Versions · ${(vers ?? []).length}`}>
          {(vers ?? []).length === 0
            ? <p className="text-sm text-muted">No versions yet — they appear here after edits.</p>
            : <ul className="text-sm">{(vers ?? []).map((v: { v: number; hash: string }) => <li key={v.v} className="py-1 border-b border-line/60 last:border-0 tabular-nums">v{v.v} · {String(v.hash).slice(0, 10)}</li>)}</ul>}
        </Card>
        <Card label="Activity">
          {(acts ?? []).length === 0
            ? <p className="text-sm text-muted">No activity recorded for this file yet.</p>
            : <ul className="text-sm">{(acts ?? []).map((a: { id: string; actor_name: string; action: string; ts: string }) => <li key={a.id} className="py-1 border-b border-line/60 last:border-0">{a.actor_name} · {a.action} · {new Date(a.ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</li>)}</ul>}
        </Card>
      </div>
    </section>
  );
}
