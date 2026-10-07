"use client";
import { useMemo, useState } from "react";
import TextView from "./TextView";
import { extractStrings, fmtBytes, sniff } from "./lib";

const HEX_BYTES = 8192;
/** Anything else: what it looks like (magic numbers), readable text pulled out of it (works for old .doc / .ppt / .msg), and a hex dump. Never a dead end. */
export default function BinaryView({ bytes, name, note }: { bytes: ArrayBuffer; name: string; note?: string }) {
  const sig = useMemo(() => sniff(bytes), [bytes]);
  const strings = useMemo(() => extractStrings(bytes), [bytes]);
  // Real prose has many dictionary-shaped words; random binary produces noise runs instead.
  const words = useMemo(() => strings.split(/\s+/).filter((w) => /^[A-Za-zÀ-ÿ]{4,}$/.test(w)).length, [strings]);
  const hasText = words >= 6;
  const [tab, setTab] = useState<"text" | "hex">(hasText ? "text" : "hex");
  const hex = useMemo(() => {
    const b = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, HEX_BYTES));
    const lines: string[] = [];
    for (let o = 0; o < b.length; o += 16) {
      const row = Array.from(b.subarray(o, o + 16));
      lines.push(`${o.toString(16).padStart(8, "0")}  ${row.map((x) => x.toString(16).padStart(2, "0")).join(" ").padEnd(47)}  ${row.map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : ".")).join("")}`);
    }
    return lines.join("\n");
  }, [bytes]);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-line text-[13px] shrink-0">
        <p className="font-medium">{sig?.label ?? "Binary file"} <span className="text-muted font-normal">· {name} · {fmtBytes(bytes.byteLength)}</span></p>
        <p className="text-muted text-[12.5px] mt-0.5">{note ?? "No visual preview exists for this format. Below is the readable text found inside it, and the raw bytes."}</p>
      </div>
      <div role="tablist" aria-label="Binary view" className="flex gap-1 px-3 py-2 border-b border-line shrink-0 text-[12.5px]">
        {([["text", "Readable text"], ["hex", "Hex dump"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-[36px] px-3 rounded-md ${tab === k ? "bg-tint text-brand font-medium" : "text-muted hover:bg-tint/60"}`}>{l}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {tab === "text"
          ? (hasText ? <TextView text={strings} note="Best-effort extraction of printable text — order and formatting may differ from the original." /> : <p className="p-8 text-center text-[14px] text-muted">No readable text found in this file.</p>)
          : <TextView text={hex} note={bytes.byteLength > HEX_BYTES ? `First ${fmtBytes(HEX_BYTES)} of ${fmtBytes(bytes.byteLength)}.` : undefined} />}
      </div>
    </div>
  );
}
