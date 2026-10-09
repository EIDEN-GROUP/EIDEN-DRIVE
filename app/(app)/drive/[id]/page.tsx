import type { Metadata } from "next";
import { createClient } from "@/lib/supabase-server";
import { adminClient } from "@/lib/supabase-admin";
import { getProfile } from "@/lib/roles";
import { Card } from "@/components/ui/primitives";
import { classify, formatBytes, badge } from "@/lib/files";
import FileActions from "@/components/drive/FileActions";
import FilePageClient from "@/components/drive/FilePageClient";

export const dynamic = "force-dynamic";

const ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || "https://drive.eiden-group.com").replace(/\/$/, "");

function kindLabel(mime: string, name: string): string {
  const e = (name.split(".").pop() ?? "").toUpperCase();
  if (mime.startsWith("image/")) return `${e} Image`;
  if (mime.startsWith("video/")) return `${e} Video`;
  if (mime.startsWith("audio/")) return `${e} Audio`;
  if (mime === "application/pdf") return "PDF Document";
  return `${e || "File"}`;
}

// Detailed unfurls for file links (Slack, WhatsApp, X): name, type, size,
// location — plus a cover image when the file is visual. Absolute URLs only.
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const supa = createClient();
  const { data: f } = await supa.from("file_index").select("id,name,mime,size,folder,drive_account_id").eq("id", params.id).maybeSingle() as { data: {
    id: string; name: string; mime: string; size: number; folder: string | null; drive_account_id: string | null;
  } | null };
  if (!f) return { title: "File not found — Eiden Drive" };
  const row = f as { id: string; name: string; mime: string; size: number; folder: string | null; drive_account_id: string | null };
  let where = "Workspace";
  if (row.folder) {
    const { data: fol } = await supa.from("folders").select("name").eq("id", row.folder).maybeSingle();
    if ((fol as { name?: string } | null)?.name) where = (fol as { name: string }).name;
  } else if (row.drive_account_id) {
    try {
      const { data: a } = await adminClient().from("drive_accounts").select("label").eq("id", row.drive_account_id).maybeSingle();
      if ((a as { label?: string } | null)?.label) where = (a as { label: string }).label;
    } catch { /* label stays Workspace */ }
  }
  const desc = `${kindLabel(row.mime, row.name)} · ${formatBytes(row.size)} · in ${where} · shared via Eiden Drive`;
  const visual = row.mime.startsWith("image/") || row.mime.startsWith("video/");
  const images = visual ? [{ url: `${ORIGIN}/api/drive/download?file_id=${row.id}&thumb=1` }] : [];
  return {
    title: `${row.name} — Eiden Drive`,
    description: desc,
    openGraph: { title: row.name, description: desc, siteName: "Eiden Drive", type: "website", images },
    twitter: { card: images.length ? "summary_large_image" : "summary", title: row.name, description: desc, images: images.map((i) => i.url) }
  };
}

export default async function FilePage({ params }: { params: { id: string } }) {
  const me = await getProfile();
  const supa = createClient();
  const { data: f } = await supa.from("file_index").select("*").eq("id", params.id).maybeSingle() as { data: {
    id: string; name: string; mime: string; size: number; folder: string | null; drive_account_id: string | null;
    backends: string[]; hash: string | null; storage_path: string | null; google_file_id: string | null;
  } | null };
  if (!f) {
    return (
      <section className="px-1 pt-1">
        <h1 className="page-title">File not found</h1>
        <p className="text-sm text-muted mt-1">It may have been trashed or you followed a stale link.</p>
        <a href="/drive" className="mt-4 inline-block min-h-[44px] px-5 leading-[44px] rounded-md bg-brand text-white text-sm font-medium">Back to Drive</a>
      </section>
    );
  }
  // Trashed files live on the Recovery Bin page — the file page says so
  // instead of rendering a ghost (actions would 409 anyway). Service-side
  // lookup: one member's trash still hides from the others.
  const { data: binned } = await adminClient().from("recovery_bin").select("file_id").eq("file_id", params.id).maybeSingle();
  if (binned) {
    return (
      <section className="px-1 pt-1">
        <h1 className="page-title">In the Recovery Bin</h1>
        <p className="text-sm text-muted mt-1">“{f.name}” was moved to the Bin. Restore it to preview, share or edit it again.</p>
        <a href="/drive" className="mt-4 inline-block min-h-[44px] px-5 leading-[44px] rounded-md bg-brand text-white text-sm font-medium">Back to Drive</a>
      </section>
    );
  }
  const { data: vers } = await supa.from("versions").select("v,hash").eq("file_id", params.id).order("v", { ascending: false }).limit(10);
  const { data: acts } = await supa.from("audit_logs").select("id,actor_name,action,ts").eq("file_id", params.id).order("ts", { ascending: false }).limit(20);
  let where = "Workspace";
  let accountLabel: string | null = null;
  if (f.folder) {
    const { data: fol } = await supa.from("folders").select("name").eq("id", f.folder).maybeSingle();
    if (fol?.name) where = fol.name;
  }
  if (f.drive_account_id && me && (me.role === "admin" || me.role === "manager")) {
    try {
      const { data: a } = await adminClient().from("drive_accounts").select("label").eq("id", f.drive_account_id).maybeSingle();
      accountLabel = (a as { label?: string } | null)?.label ?? null;
    } catch { /* stays null */ }
  }

  const meta: [string, string][] = [
    ["Type", kindLabel(f.mime, f.name)],
    ["Size", formatBytes(f.size)],
    ["Location", where],
    ...(accountLabel ? [["Drive account", accountLabel] as [string, string]] : []),
    ["Backends", badge(f.backends ?? ["google"]) || "—"],
    ["SHA-256", f.hash ? `${String(f.hash).slice(0, 16)}…` : "—"]
  ];

  return (
    <section className="px-1 pt-1 max-w-5xl mx-auto">
      <a href="/drive" className="text-[13px] text-muted hover:text-brand">← Back to Drive</a>
      <div className="mt-2 grid md:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <Card label={`${classify(f.name, f.mime)} · ${formatBytes(f.size)}`}>
          <h1 className="page-title mt-1 break-all">{f.name}</h1>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
            {meta.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt>
                <dd className="text-[13.5px] truncate" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
          <FileActions id={f.id} name={f.name} googleId={f.google_file_id} downloadable={!!f.storage_path} />
          <FilePageClient file={{ id: (f as { id: string }).id, name: f.name, mime: f.mime, size: f.size, backends: f.backends ?? ["google"], google_file_id: f.google_file_id ?? null }} />
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
      </div>
    </section>
  );
}
