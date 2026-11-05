"use client";
import { useEffect, useState } from "react";
import Logo from "@/components/ui/Logo";
import MarkdownView from "@/components/viewer/MarkdownView";
import TextView from "@/components/viewer/TextView";

interface Meta {
  kind?: "file" | "folder";
  name: string; mime: string; size: number; backends: string[];
  hasCover: boolean;
  children?: { id: string; name: string; mime: string; size: number }[];
  hasMore?: boolean;
}

function fmtSize(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${u[i]}`;
}

// Public file page: preview for everything previewable, download for the rest.
// No login, no edit, no listing — the token unlocks exactly one file.
export default function ShareView({ token, initial }: { token: string; initial: { name: string; mime: string; size: number } | null }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [dead, setDead] = useState(false);
  const raw = `/api/share/${token}/raw`;
  const dl = `/api/share/${token}/raw`;

  useEffect(() => {
    let gone = false;
    fetch(`/api/share/${token}/meta`).then((r) => r.json().then((d) => ({ ok: r.ok, d })).catch(() => ({ ok: false, d: {} }))).then(({ ok, d }) => {
      if (gone) return;
      if (!ok) { setDead(true); return; }
      setMeta(d);
    }).catch(() => { if (!gone) setDead(true); });
    return () => { gone = true; };
  }, [token]);

  useEffect(() => {
    if (!meta) return;
    const textual = meta.mime.startsWith("text/") || meta.mime === "application/json" || /\.md$|\.markdown$/i.test(meta.name);
    if (!textual || meta.size > 5 * 1024 * 1024) return;
    let gone = false;
    fetch(raw).then((r) => {
      if (!r.ok) throw new Error();
      return r.arrayBuffer();
    }).then((buf) => {
      if (gone) return;
      try { setText(new TextDecoder().decode(buf)); } catch { /* binary after all */ }
    }).catch(() => {});
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const name = meta?.name ?? initial?.name ?? "Shared file";
  const mime = meta?.mime ?? initial?.mime ?? "";
  const isImg = mime.startsWith("image/");
  const isVid = mime.startsWith("video/");
  const isAud = mime.startsWith("audio/");
  const isPdf = mime === "application/pdf";
  const isMd = /\.md$|\.markdown$/i.test(name);

  return (
    <main className="min-h-screen grid place-items-center p-4 sm:p-8 bg-canvas">
      <section aria-label={dead ? "Link unavailable" : `Shared file ${name}`}
        className="w-full max-w-3xl rounded-[24px] bg-surface border border-line shadow-win overflow-hidden">
        <div className="flex items-center gap-3 px-5 min-h-[60px] border-b border-line">
          <Logo size={30} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium truncate">{name}</p>
            <p className="text-[11.5px] text-muted">Shared via Eiden Drive{meta ? ` · ${fmtSize(meta.size)}` : ""}</p>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          {dead || (meta === null && initial === null) ? (
            <div className="text-center py-10">
              <p className="text-[16px] font-medium">This link doesn't work anymore</p>
              <p className="mt-1 text-[13.5px] text-muted">It expired, was revoked, or the file was deleted. Ask the sender for a fresh link.</p>
            </div>
          ) : meta?.kind === "folder" ? (
            <div className="space-y-3">
              <p className="text-[14px] text-muted">Folder — {meta.children?.length ?? 0} item{meta.children?.length === 1 ? "" : "s"}</p>
              <ul className="divide-y divide-line border border-line rounded-lg overflow-hidden">
                {(meta.children ?? []).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 bg-surface">
                    <span className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium truncate">{c.name}</p>
                      <p className="text-[11.5px] text-muted">{c.mime.split("/")[1] ?? c.mime} · {c.mime === "application/vnd.google-apps.folder" ? "Folder" : fmtSize(c.size)}</p>
                    </span>
                    {c.mime !== "application/vnd.google-apps.folder" && (
                      <a href={`/api/share/${token}/raw?file=${encodeURIComponent(c.id)}`} className="min-h-[36px] px-3 rounded-md border border-line text-[12.5px] inline-flex items-center hover:bg-tint">Download</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : !meta ? (
            <div className="space-y-3" aria-label="Loading shared file">
              <div className="skel h-5 w-2/3" /><div className="skel h-64 w-full" />
            </div>
          ) : isImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={raw} alt={name} className="mx-auto max-h-[65vh] rounded-lg object-contain" />
          ) : isVid ? (
            <video src={raw} controls playsInline preload="metadata" className="w-full max-h-[65vh] rounded-lg bg-black" />
          ) : isAud ? (
            <div className="py-8 text-center">
              <p className="text-[40px]" aria-hidden="true">♪</p>
              <audio src={raw} controls className="w-full mt-4" preload="metadata" />
            </div>
          ) : isPdf ? (
            <iframe src={raw} title={name} className="w-full h-[65vh] rounded-lg border border-line bg-white" />
          ) : isMd && text !== null ? (
            <article className="md-body"><MarkdownView text={text} /></article>
          ) : text !== null ? (
            <TextView text={text} />
          ) : (
            <div className="text-center py-10">
              <p className="text-[15px]">Preview isn't available for this format.</p>
              <a href={dl} className="mt-4 inline-flex min-h-[44px] items-center px-5 rounded-md bg-brand text-white text-sm font-medium">Download {name.length > 30 ? name.slice(0, 29) + "…" : name}</a>
            </div>
          )}
          {meta && (isImg || isVid || isAud || isPdf) && (
            <div className="mt-4 text-center">
              <a href={dl} className="inline-flex min-h-[44px] items-center px-5 rounded-md border border-line text-sm hover:bg-tint">Download original</a>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
