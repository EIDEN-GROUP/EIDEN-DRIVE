"use client";
import { useEffect, useState } from "react";

const SAMPLE = "The quick brown fox jumps over the lazy dog";
/** Fonts (ttf · otf · woff · woff2): loaded with the FontFace API into a private family — specimen at several sizes, editable sample. */
export default function FontView({ bytes, name }: { bytes: ArrayBuffer; name: string }) {
  const [family, setFamily] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [text, setText] = useState(SAMPLE);
  useEffect(() => {
    let dead = false; let face: FontFace | null = null;
    const fam = `preview-${Math.random().toString(36).slice(2)}`;
    (async () => {
      try { face = new FontFace(fam, bytes.slice(0)); await face.load(); document.fonts.add(face); if (!dead) setFamily(fam); }
      catch { if (!dead) setErr(true); }
    })();
    return () => { dead = true; if (face) document.fonts.delete(face); };
  }, [bytes]);
  if (err) return <p className="p-8 text-center text-[14px] text-muted">This font file couldn’t be loaded by the browser.</p>;
  if (!family) return <div className="p-6"><div className="skel h-24 w-full" /></div>;
  const st = { fontFamily: `"${family}", sans-serif` };
  return (
    <div className="p-5 sm:p-8 max-w-3xl mx-auto">
      <p className="text-[12px] text-muted mb-2">{name}</p>
      <label className="sr-only" htmlFor="font-sample">Sample text</label>
      <input id="font-sample" value={text} onChange={(e) => setText(e.target.value)} className="w-full min-h-[44px] rounded-md border border-line bg-surface px-3 text-[14px] mb-5 focus:border-brand focus:outline-none" />
      {[64, 40, 28, 20, 14].map((s) => <p key={s} className="mb-3 break-words leading-tight" style={{ ...st, fontSize: s }}>{text || SAMPLE}</p>)}
      <div className="mt-6 space-y-2" style={st}>
        <p className="text-[24px]">ABCDEFGHIJKLMNOPQRSTUVWXYZ</p><p className="text-[24px]">abcdefghijklmnopqrstuvwxyz</p>
        <p className="text-[24px]">0123456789 !?&amp;@#%$€£ ÀÉÎÕÜ çñß</p>
      </div>
    </div>
  );
}
