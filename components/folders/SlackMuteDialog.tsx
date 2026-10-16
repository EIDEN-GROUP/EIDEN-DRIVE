"use client";
import { useEffect, useState } from "react";
import { BellOff, Bell, Check } from "lucide-react";
import Modal from "../ui/Modal";
import { Ring } from "../ui/Loaders";
import { toast } from "../ui/Toast";

export interface MuteTarget {
  scope: "workspace" | "drive";
  /** workspace folder uuid, or file_index id of a google-folder row */
  id: string;
  account?: string;
  name: string;
}

interface Descendant {
  id: string; label: string; depth: number;
  muted: boolean; effectiveMuted: boolean;
  scope: "workspace" | "drive"; accountId?: string; googleId?: string;
}

/** Per-folder Slack mute dialog: toggle the folder, optionally pick which
 *  subfolders to mute/unmute alongside it. Slack-only — in-app notifications
 *  and audit logging are never affected. */
export default function SlackMuteDialog({ target, onClose, onSaved }: {
  target: MuteTarget; onClose: () => void; onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [effective, setEffective] = useState(false);
  const [subs, setSubs] = useState<Descendant[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let dead = false;
    const q = target.scope === "workspace"
      ? `scope=workspace&id=${encodeURIComponent(target.id)}&tree=1`
      : `scope=drive&id=${encodeURIComponent(target.id)}&account=${encodeURIComponent(target.account ?? "")}&tree=1`;
    fetch(`/api/folders/slack-mute?${q}`).then((r) => r.json().catch(() => ({}))).then((d) => {
      if (dead) return;
      if (!d.ok) { setError(d.error ?? "Couldn't load mute settings."); setLoading(false); return; }
      setMuted(!!d.muted);
      setEffective(!!d.effectiveMuted);
      setSubs((d.descendants ?? []) as Descendant[]);
      // Pre-check currently-muted subfolders so "save" is a no-op unless changed.
      setPicked(new Set(((d.descendants ?? []) as Descendant[]).filter((s) => s.muted).map((s) => s.id)));
      setLoading(false);
    }).catch(() => { if (!dead) { setError("Couldn't reach the server."); setLoading(false); } });
    return () => { dead = true; };
  }, [target]);

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const allPicked = subs.length > 0 && subs.every((s) => picked.has(s.id));

  async function save(nextMuted: boolean) {
    setSaving(true);
    setError("");
    const body = {
      target: { scope: target.scope, id: target.id, ...(target.account ? { account: target.account } : {}) },
      muted: nextMuted,
      also: subs.filter((s) => picked.has(s.id)).map((s) => s.id),
    };
    try {
      const r = await fetch("/api/folders/slack-mute", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Couldn't save.");
      toast({ text: nextMuted ? "Slack notifications muted here." : "Slack notifications unmuted here.", tone: "ok" });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={muted ? "Unmute Slack notifications" : "Mute Slack notifications"} onClose={onClose} width={460} labelId="slack-mute">
      <p className="text-[12.5px] text-muted -mt-1 mb-3 truncate">For “{target.name}” · Slack posts only — in-app notifications keep working.</p>
      {loading ? (
        <div className="py-8 grid place-items-center" role="status" aria-label="Loading mute settings"><Ring className="size-6" /></div>
      ) : error && !subs.length && loading === false && muted === false && effective === false ? (
        <p className="text-[14px] text-danger py-4" role="alert">{error}</p>
      ) : (
        <>
          {error && <p className="text-[13.5px] text-danger mb-2" role="alert">{error}</p>}
          {effective && !muted && (
            <p className="mb-3 rounded-lg border border-line bg-soft px-3 py-2.5 text-[13px] text-ink/80">
              A parent folder is muted, so uploads here already skip Slack. Muting here as well keeps it muted if this folder moves.
            </p>
          )}
          {subs.length > 0 && (
            <>
              <div className="flex items-center justify-between mt-1 mb-1">
                <p className="text-[13px] font-medium">Subfolders ({subs.length})</p>
                <button
                  onClick={() => setPicked(allPicked ? new Set() : new Set(subs.map((s) => s.id)))}
                  className="min-h-[36px] px-2 text-[12.5px] text-brand font-medium hover:underline">
                  {allPicked ? "Select none" : "Select all"}
                </button>
              </div>
              <p className="text-[12px] text-muted mb-2">Tick subfolders to {muted ? "unmute" : "mute"} them too — unticked ones keep their current setting.</p>
              <ul className="max-h-[260px] overflow-auto -mx-1 border border-line rounded-lg divide-y divide-line" aria-label="Subfolders">
                {subs.map((s) => {
                  const on = picked.has(s.id);
                  return (
                    <li key={s.id}>
                      <button onClick={() => toggle(s.id)}
                        className="w-full min-h-[44px] px-2 rounded-md flex items-center gap-3 text-left hover:bg-tint transition-colors"
                        role="checkbox" aria-checked={on} aria-label={`${s.label}${s.effectiveMuted && !s.muted ? " (muted via parent)" : ""}`}>
                        <span className={`size-5 rounded border grid place-items-center shrink-0 ${on ? "border-transparent bg-brand" : "border-line"}`}>
                          {on && <Check size={13} className="text-white" strokeWidth={3} />}
                        </span>
                        <span className="flex-1 truncate text-[13.5px]" style={{ paddingLeft: Math.min(s.depth, 6) * 14 }}>
                          {s.label}
                        </span>
                        {s.effectiveMuted && !s.muted && <span className="text-[10.5px] text-muted shrink-0">via parent</span>}
                        {s.muted && <span className="text-[10.5px] text-brand shrink-0">muted</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="mt-4 flex gap-2 justify-end">
            <button onClick={onClose} disabled={saving} className="min-h-[44px] px-5 rounded-md border border-line text-[13.5px] font-medium hover:bg-tint disabled:opacity-50">
              Cancel
            </button>
            <button onClick={() => save(!muted)} disabled={saving}
              className="min-h-[44px] px-5 rounded-md bg-brand text-white text-[13.5px] font-medium hover:brightness-110 disabled:opacity-50 inline-flex items-center gap-2">
              {saving ? <Ring className="size-4" /> : muted ? <Bell size={15} /> : <BellOff size={15} />}
              {saving ? "Saving…" : muted ? "Unmute" : "Mute"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
