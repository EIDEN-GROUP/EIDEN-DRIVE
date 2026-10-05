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
    <div className="fixed bottom-16 md:bottom-6 right-4 z-[100] flex flex-col gap-2" aria-live="polite" role="status">
      {items.map((t) => (
        <div key={t.id} className={`px-4 py-3 rounded-2xl shadow-lg text-sm text-white ${t.tone === "err" ? "bg-red-700" : t.tone === "ok" ? "bg-teal-700" : "bg-neutral-900"}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
