"use client";
import { useEffect, useRef, useState } from "react";
import { X, Camera, Loader2, Pencil, KeyRound, LogOut } from "lucide-react";
import { toast } from "../ui/Toast";
import { browserClient } from "@/lib/supabase-client";

interface Profile {
  id: string; username: string; role: string; department_tag: string | null;
  phone: string | null; avatar_path: string | null; avatarUrl: string | null; created_at: string;
}

// Account modal: picture, identity, editable phone. Username/role/department
// stay admin-managed (identity + permission boundaries — see /api/profile).
export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [upping, setUpping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      const [pr, au] = await Promise.all([
        fetch("/api/profile").then((r) => r.json().catch(() => ({}))),
        browserClient().auth.getUser().then(({ data }) => data.user).catch(() => null)
      ]);
      if (dead) return;
      if (pr.id) { setP(pr); setPhone(pr.phone ?? ""); }
      if (au?.email) setEmail(au.email);
    })();
    return () => { dead = true; };
  }, []);

  async function savePhone() {
    setSaving(true);
    const r = await fetch("/api/profile", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: phone.trim() || null })
    });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { toast({ text: d.error ?? "Couldn't save.", tone: "err" }); return; }
    setP((prev) => prev && { ...prev, phone: phone.trim() || null });
    setEditing(false);
    toast({ text: "Profile updated.", tone: "ok" });
  }

  async function uploadAvatar(files: FileList | null) {
    const f = files?.[0];
    if (!f || !p) return;
    if (!f.type.startsWith("image/")) { toast({ text: "Pick an image file.", tone: "err" }); return; }
    if (f.size > 5 * 1024 * 1024) { toast({ text: "Max 5 MB.", tone: "err" }); return; }
    setUpping(true);
    try {
      const ext = (f.name.split(".").pop() ?? "png").toLowerCase();
      const init = await fetch("/api/drive/upload-url", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `avatar.${ext}`, mime: f.type, size: f.size, bucket: "pfp" })
      });
      const dj = await init.json().catch(() => ({}));
      if (!init.ok) throw new Error(dj.error ?? "upload init failed");
      const put = await fetch(dj.signedUrl, { method: "PUT", headers: { "content-type": f.type }, body: f });
      if (!put.ok) throw new Error("upload failed");
      // Avatars are profile data, not files: no file_index row (never listed,
      // never notified, never mirrored) — just point the profile at the bytes.
      // The server deletes the previous picture object (same bucket, own prefix).
      const patch = await fetch("/api/profile", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ avatar_path: dj.path })
      });
      const pd = await patch.json().catch(() => ({}));
      if (!patch.ok) throw new Error(pd.error ?? "profile update failed");
      const fresh = await fetch("/api/profile").then((r) => r.json().catch(() => ({})));
      if (fresh.id) setP(fresh);
      toast({ text: "Profile picture updated.", tone: "ok" });
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : "Upload failed.", tone: "err" });
    } finally {
      setUpping(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Your profile">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="pop-in relative w-full max-w-sm rounded-xl bg-surface border border-line shadow-pop overflow-hidden">
        <div className="flex items-center min-h-[56px] px-4 border-b border-line">
          <p className="text-[15px] font-medium flex-1">Your profile</p>
          <button onClick={onClose} aria-label="Close profile" className="size-11 grid place-items-center rounded-md hover:bg-tint"><X size={18} /></button>
        </div>
        {!p ? (
          <div className="p-6 space-y-3" aria-label="Loading profile">
            <div className="skel size-20 rounded-full mx-auto" /><div className="skel h-4 w-2/3 mx-auto" />
          </div>
        ) : (
          <div className="p-5 flex flex-col items-center text-center">
            <div className="relative">
              {p.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatarUrl} alt="Your profile picture" className="size-20 rounded-full object-cover border border-line" />
              ) : (
                <span className="size-20 rounded-full bg-brand text-white grid place-items-center text-[28px] font-medium">
                  {p.username.slice(0, 1).toLowerCase()}
                </span>
              )}
              <button onClick={() => fileRef.current?.click()} disabled={upping} aria-label="Change profile picture"
                className="absolute -bottom-1 -right-1 size-9 grid place-items-center rounded-full bg-brand text-white shadow-pop disabled:opacity-50">
                {upping ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Choose profile picture" onChange={(e) => uploadAvatar(e.target.files)} />
            </div>
            <p className="mt-3 text-[16px] font-medium">{p.username}</p>
            <p className="text-[12px] text-muted capitalize">{p.role}{p.department_tag ? ` · ${p.department_tag}` : ""}</p>
            <dl className="mt-4 w-full text-left text-[13px] space-y-2.5">
              {email && <div className="flex justify-between gap-3"><dt className="text-muted">Email</dt><dd className="truncate">{email}</dd></div>}
              <div className="flex justify-between gap-3 items-center">
                <dt className="text-muted">Phone</dt>
                {editing ? (
                  <dd className="flex gap-1.5">
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} placeholder="+…"
                      aria-label="Phone number" className="min-h-[40px] w-36 rounded-md border border-line bg-surface px-2 text-[13px]" />
                    <button onClick={savePhone} disabled={saving} className="min-h-[40px] px-3 rounded-md bg-brand text-white text-[12px] font-medium disabled:opacity-50">
                      {saving ? "…" : "Save"}
                    </button>
                  </dd>
                ) : (
                  <dd className="flex items-center gap-1.5">
                    <span>{p.phone ?? <span className="text-muted">—</span>}</span>
                    <button onClick={() => setEditing(true)} aria-label="Edit phone" className="size-8 grid place-items-center rounded-md hover:bg-tint text-muted"><Pencil size={13} /></button>
                  </dd>
                )}
              </div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Member since</dt><dd>{new Date(p.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</dd></div>
            </dl>
            <div className="mt-4 w-full border-t border-line pt-3 flex gap-2">
              <a href="/account/password" className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-md border border-line text-[13px] hover:bg-tint">
                <KeyRound size={14} /> Set password
              </a>
              <button onClick={async () => { await browserClient().auth.signOut(); window.location.href = "/login"; }}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-md border border-line text-[13px] hover:bg-tint">
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
