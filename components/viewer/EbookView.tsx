"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { sanitizeHtml } from "./lib";

interface Chapter { href: string; html: string }

/** EPUB reader: chapters in reading order (spine), inline pictures, sanitised. */
export default function EbookView({ bytes }: { bytes: ArrayBuffer }) {
  const [ch, setCh] = useState<Chapter[] | null>(null);
  const [title, setTitle] = useState("");
  const [i, setI] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(bytes);
        const read = async (p: string) => zip.files[p] ? zip.files[p].async("string") : null;
        const container = await read("META-INF/container.xml");
        const opfPath = /full-path="([^"]+)"/.exec(container ?? "")?.[1];
        if (!opfPath) throw new Error("not a valid epub");
        const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
        const opf = new DOMParser().parseFromString((await read(opfPath)) ?? "", "application/xml");
        const manifest = new Map<string, { href: string; type: string }>();
        for (const it of Array.from(opf.getElementsByTagName("item"))) manifest.set(it.getAttribute("id") ?? "", { href: it.getAttribute("href") ?? "", type: it.getAttribute("media-type") ?? "" });
        const t = opf.getElementsByTagName("dc:title")[0]?.textContent ?? "";
        const out: Chapter[] = [];
        for (const ref of Array.from(opf.getElementsByTagName("itemref")).slice(0, 400)) {
          const m = manifest.get(ref.getAttribute("idref") ?? "");
          if (!m) continue;
          const path = decodeURIComponent(base + m.href);
          let xhtml = await read(path);
          if (!xhtml) continue;
          const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
          const bodyHtml = /<body[^>]*>([\s\S]*)<\/body>/i.exec(xhtml)?.[1] ?? xhtml;
          // inline pictures as data URIs (sanitiser only allows data:image, never remote loads)
          const imgs = [...bodyHtml.matchAll(/<img[^>]+src="([^"]+)"/gi)];
          let html = bodyHtml;
          for (const im of imgs) {
            const rel = decodeURIComponent(im[1]); if (/^(https?:|data:)/.test(rel)) continue;
            const full = (dir + rel).split("/").reduce<string[]>((a, s) => (s === ".." ? a.slice(0, -1) : s === "." ? a : [...a, s]), []).join("/");
            const f = zip.files[full]; if (!f) continue;
            const ext = full.split(".").pop()!.toLowerCase();
            const mime = ext === "jpg" ? "jpeg" : ext;
            if (!["png", "jpeg", "gif", "webp"].includes(mime)) continue;
            html = html.split(im[1]).join(`data:image/${mime};base64,${await f.async("base64")}`);
          }
          out.push({ href: m.href, html: sanitizeHtml(html) });
        }
        if (!dead) { setCh(out.filter((c) => c.html.replace(/<[^>]+>/g, "").trim() || /<img/i.test(c.html))); setTitle(t); }
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : "couldn't read this book"); }
    })();
    return () => { dead = true; };
  }, [bytes]);
  if (err) return <p className="p-8 text-center text-[14px] text-muted">This ebook couldn’t be read ({err}).</p>;
  if (!ch) return <div className="p-6 space-y-3" aria-label="Opening book"><div className="skel h-5 w-1/2" /><div className="skel h-4 w-full" /></div>;
  if (!ch.length) return <p className="p-8 text-center text-[14px] text-muted">No readable chapters found.</p>;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line shrink-0 text-[12.5px]">
        <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} aria-label="Previous chapter" className="size-10 grid place-items-center rounded-md hover:bg-tint disabled:opacity-40"><ChevronLeft size={17} /></button>
        <span className="flex-1 text-center truncate text-muted">{title ? `${title} · ` : ""}Section {i + 1} of {ch.length}</span>
        <button onClick={() => setI((x) => Math.min(ch.length - 1, x + 1))} disabled={i === ch.length - 1} aria-label="Next chapter" className="size-10 grid place-items-center rounded-md hover:bg-tint disabled:opacity-40"><ChevronRight size={17} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto bg-soft"><article key={i} className="md-body mx-auto max-w-[680px] bg-surface p-6 sm:p-10 min-h-full" dangerouslySetInnerHTML={{ __html: ch[i].html }} /></div>
    </div>
  );
}
