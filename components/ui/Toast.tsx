"use client";
import { useEffect, useState } from "react";

export interface ToastMsg { id: number; text: string; tone?: "ok" | "err" | "info" }

let pushFn: ((t: Omit<ToastMsg, "id">) => void) | null = null;
let seq = 1;

/** Global toast bus: `import { toast } from "@/components/ui/Toast"; toast({text})` */
export function toast(t: Omit<ToastMsg, "id">) { pushFn?.(t); }

export function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    pushFn = (t) => {
      const id = seq++;
      setItems((p) => [...p, { ...t, id }]);
      setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), 4000);
    };
    return () => { pushFn = null; };
  }, []);
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2" aria-live="polite" role="status">
      {items.map((t) => (
        <div key={t.id} className={`pop-in px-4 py-3 rounded-lg shadow-pop text-[13px] text-white ${t.tone === "err" ? "bg-danger" : t.tone === "ok" ? "bg-brand" : "bg-[#2b2b36]"}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
