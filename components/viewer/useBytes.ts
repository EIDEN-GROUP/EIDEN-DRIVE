"use client";
import { useEffect, useState } from "react";
import type { ViewFile } from "../drive/FileViewer";

export const BYTES_CAP = 80 * 1024 * 1024; // what we are willing to hold in a browser tab

/** Loads a file's bytes. Same-origin raw endpoint first (works for Google- and Supabase-hosted files); for
 *  larger local files falls back to the short signed URL. Never silent: errors explain what to do. */
export function useBytes(file: ViewFile, enabled = true) {
  const [state, setState] = useState<{ bytes: ArrayBuffer | null; loading: boolean; error: string | null; tooLarge: boolean }>({ bytes: null, loading: enabled, error: null, tooLarge: false });
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    const ctrl = new AbortController();
    (async () => {
      try {
        let r = await fetch(`/api/drive/download?file_id=${encodeURIComponent(file.id)}&raw=1`, { signal: ctrl.signal });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          if (d.too_large && file.backends?.includes("local") && (file.size ?? 0) <= BYTES_CAP) {
            const j = await fetch(`/api/drive/download?file_id=${encodeURIComponent(file.id)}&json=1`, { signal: ctrl.signal }).then((x) => x.json());
            r = await fetch(j.url, { signal: ctrl.signal });
          } else {
            if (!dead) setState({ bytes: null, loading: false, error: d.error ?? `preview failed (${r.status})`, tooLarge: !!d.too_large });
            return;
          }
        }
        if (!r.ok) throw new Error(`couldn't read the file (${r.status})`);
        const buf = await r.arrayBuffer();
        if (!dead) setState({ bytes: buf, loading: false, error: null, tooLarge: false });
      } catch (e) {
        if (!dead && (e as Error).name !== "AbortError") setState({ bytes: null, loading: false, error: e instanceof Error ? e.message : "Couldn't load the file.", tooLarge: false });
      }
    })();
    return () => { dead = true; ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, enabled]);
  return state;
}
