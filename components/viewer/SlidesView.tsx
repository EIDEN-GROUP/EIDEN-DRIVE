"use client";
import { useEffect, useState } from "react";

interface Slide { n: number; paras: string[]; images: string[]; notes: string }

const text = (xml: string): string[] => {
  const paras: string[] = [];
  for (const p of xml.split(/<a:p[ >]/).slice(1)) {
    const t = [...p.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("");
    if (t.trim()) paras.push(t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }
  return paras;
};
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml" };

/** PowerPoint (.pptx): every slide's text (in reading order), speaker notes and pictures. Layout/animations are not reproduced. */
export default function SlidesView({ bytes }: { bytes: ArrayBuffer }) {
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let dead = false; const urls: string[] = [];
    (async () => {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(bytes);
        const names = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => parseInt(a.match(/(\d+)\.xml/)![1]) - parseInt(b.match(/(\d+)\.xml/)![1]));
        const out: Slide[] = [];
        for (const f of names) {
          const n = parseInt(f.match(/(\d+)\.xml/)![1]);
          const xml = await zip.files[f].async("string");
          const rels = zip.files[`ppt/slides/_rels/slide${n}.xml.rels`] ? await zip.files[`ppt/slides/_rels/slide${n}.xml.rels`].async("string") : "";
          const images: string[] = [];
          for (const m of rels.matchAll(/Target="\.\.\/media\/([^"]+)"/g)) {
            const ext = m[1].split(".").pop()!.toLowerCase();
            const file = zip.files[`ppt/media/${m[1]}`];
            if (file && MIME[ext]) { const u = URL.createObjectURL(new Blob([await file.async("arraybuffer")], { type: MIME[ext] })); urls.push(u); images.push(u); }
          }
          const nf = zip.files[`ppt/notesSlides/notesSlide${n}.xml`];
          out.push({ n, paras: text(xml), images, notes: nf ? text(await nf.async("string")).join("\n") : "" });
        }
        if (!dead) setSlides(out);
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : "couldn't read this presentation"); }
    })();
    return () => { dead = true; urls.forEach(URL.revokeObjectURL); };
  }, [bytes]);

  if (err) return <p className="p-8 text-center text-[14px] text-muted">This presentation couldn’t be read ({err}).</p>;
  if (!slides) return <div className="p-6 space-y-3" aria-label="Reading presentation"><div className="skel h-40 w-full" /><div className="skel h-40 w-full" /></div>;
  if (!slides.length) return <p className="p-8 text-center text-[14px] text-muted">No slides found in this file.</p>;
  return (
    <div className="bg-soft min-h-full p-3 sm:p-6 space-y-5">
      <p className="text-center text-[11px] text-muted">{slides.length} slide{slides.length === 1 ? "" : "s"} · text, notes and pictures — layout and animations are not reproduced.</p>
      {slides.map((s) => (
        <section key={s.n} aria-label={`Slide ${s.n}`} className="mx-auto max-w-3xl">
          <p className="text-[11px] text-muted mb-1 tabular-nums">Slide {s.n}</p>
          <div className="bg-surface border border-line rounded-lg shadow-sm p-5 sm:p-8 min-h-[200px]">
            {s.paras.length ? <>
              <h3 className="text-[19px] font-semibold leading-snug">{s.paras[0]}</h3>
              <ul className="mt-3 space-y-1.5 text-[14.5px]">{s.paras.slice(1).map((p, i) => <li key={i} className="pl-3 border-l-2 border-line">{p}</li>)}</ul>
            </> : <p className="text-[13px] text-muted">(no text on this slide)</p>}
            {s.images.length > 0 && <div className="mt-4 flex flex-wrap gap-3">{s.images.map((u, i) => /* eslint-disable-next-line @next/next/no-img-element */ <img key={i} src={u} alt={`Slide ${s.n} picture ${i + 1}`} className="max-h-48 rounded border border-line" />)}</div>}
          </div>
          {s.notes && <p className="mt-2 text-[12.5px] text-muted whitespace-pre-wrap"><span className="font-medium">Notes: </span>{s.notes}</p>}
        </section>
      ))}
    </div>
  );
}
