"use client";
import { useEffect, useMemo, useState } from "react";
import { File as FileIcon, Folder } from "lucide-react";
import { fmtBytes, gunzip, parseTar, type ArchEntry } from "./lib";
import TextView from "./TextView";
import { decodeText, looksLikeText } from "./lib";

/** Archive contents (zip & friends, tar, tar.gz/tgz, gz). Listing only — nothing is extracted or executed. */
export default function ArchiveView({ bytes, name }: { bytes: ArrayBuffer; name: string }) {
  const [entries, setEntries] = useState<ArchEntry[] | null>(null);
  const [inner, setInner] = useState<string | null>(null); // a .gz that wraps a single text file
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const b = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
        const isZip = b[0] === 0x50 && b[1] === 0x4b;
        const isGz = b[0] === 0x1f && b[1] === 0x8b;
        if (isZip) {
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(bytes);
          const out: ArchEntry[] = Object.values(zip.files).map((f) => ({ name: f.name, dir: f.dir, size: (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0, date: f.date }));
          if (!dead) setEntries(out);
        } else if (isGz) {
          const raw = await gunzip(bytes);
          const tarLike = /\.(tar\.gz|tgz)$/i.test(name) || new TextDecoder().decode(new Uint8Array(raw, 257, 5)) === "ustar";
          if (tarLike) { if (!dead) setEntries(parseTar(raw)); }
          else if (looksLikeText(raw)) { if (!dead) { setInner(decodeText(raw.byteLength > 5_000_000 ? raw.slice(0, 5_000_000) : raw)); setEntries([]); } }
          else if (!dead) { setEntries([{ name: name.replace(/\.gz$/i, ""), size: raw.byteLength, dir: false }]); setNote("Compressed single file (binary)."); }
        } else if (new TextDecoder().decode(new Uint8Array(bytes, 257, 5)) === "ustar") {
          if (!dead) setEntries(parseTar(bytes));
        } else if (!dead) { setEntries([]); setNote("This archive type (7z, rar, bz2, xz…) can’t be opened in the browser. Download it and open it with an archive tool."); }
      } catch (e) { if (!dead) { setEntries([]); setNote(`Couldn’t read this archive (${e instanceof Error ? e.message : "damaged or password-protected"}).`); } }
    })();
    return () => { dead = true; };
  }, [bytes, name]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (entries ?? []).filter((e) => e.name.replace(/\/$/, "") !== "." && (!n || e.name.toLowerCase().includes(n))).slice(0, 5000);
  }, [entries, q]);

  if (inner !== null) return <TextView text={inner} note="Decompressed text file (gzip)." />;
  if (!entries) return <div className="p-6 space-y-3" aria-label="Reading archive"><div className="skel h-5 w-1/3" /><div className="skel h-32 w-full" /></div>;
  const files = entries.filter((e) => !e.dir);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line shrink-0 text-[12px] text-muted">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in archive" aria-label="Find in archive"
          className="min-h-[36px] w-44 rounded-md border border-line bg-surface px-2.5 text-[12.5px] text-ink focus:border-brand focus:outline-none" />
        <span className="flex-1" />
        <span className="tabular-nums">{files.length.toLocaleString()} files · {fmtBytes(files.reduce((a, e) => a + e.size, 0))} unpacked</span>
      </div>
      {note && <p className="px-4 py-3 text-[13px] text-muted bg-soft border-b border-line">{note}</p>}
      <ul className="flex-1 min-h-0 overflow-auto text-[13px]" aria-label="Archive contents">
        {shown.map((e) => {
          const depth = e.name.replace(/\/$/, "").split("/").length - 1;
          const base = e.name.replace(/\/$/, "").split("/").pop();
          return (
            <li key={e.name} className="flex items-center gap-2 px-3 h-8 border-b border-line/50 hover:bg-tint/40" style={{ paddingLeft: 12 + Math.min(depth, 8) * 14 }}>
              {e.dir ? <Folder size={15} className="text-brand shrink-0" /> : <FileIcon size={15} className="text-muted shrink-0" />}
              <span className="truncate flex-1" title={e.name}>{base}</span>
              {!e.dir && <span className="text-[11px] text-muted tabular-nums shrink-0">{fmtBytes(e.size)}</span>}
            </li>
          );
        })}
        {shown.length === 0 && !note && <li className="p-8 text-center text-muted">{q ? "No matches." : "This archive is empty."}</li>}
      </ul>
    </div>
  );
}
