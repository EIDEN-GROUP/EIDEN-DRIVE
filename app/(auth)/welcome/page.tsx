"use client";
import { useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase-client";
import Logo from "@/components/ui/Logo";

type Phase = "signin" | "details" | "verify" | "done";

// Invite onboarding. Supabase's invite link returns the session in the URL hash
// (browser-only) — once signed in, the new member: (1) picks name + phone +
// optional picture, (2) proves the inbox with a 6-digit OTP code, (3) lands in /drive.
// Returning members (phone already set) skip straight through.
export default function Welcome() {
  const [phase, setPhase] = useState<Phase>("signin");
  const [msg, setMsg] = useState("Signing you in…");
  const [failed, setFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatar, setAvatar] = useState<{ path: string } | null>(null);
  const [upping, setUpping] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cool, setCool] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const supa = browserClient();
    const finish = async () => {
      if (done.current) return;
      done.current = true;
      const { data: { user } } = await supa.auth.getUser();
      if (!user?.email) { setFailed(true); setMsg("This invite link has expired or was already used. Ask a manager to send a new one."); return; }
      setEmail(user.email);
      const pr = await fetch("/api/profile").then((r) => r.json().catch(() => ({})));
      if (pr.phone) { window.location.replace("/drive"); return; }
      setName((pr.username && !pr.username.includes("-") ? pr.username : user.email.split("@")[0]).replace(/[^a-z0-9._-]/gi, ""));
      setPhase("details");
    };
    // Invite links land here with ?token_hash=…&type=invite — exchange first.
    const sp = new URLSearchParams(window.location.search);
    const token_hash = sp.get("token_hash");
    const type = sp.get("type");
    if (token_hash && (type === "invite" || type === "magiclink" || type === "recovery")) {
      supa.auth.verifyOtp({ token_hash, type: type as "invite" }).then(({ error }) => {
        if (error) { setFailed(true); setMsg("This invite link has expired or was already used. Ask a manager to send a new one."); }
        else finish();
      });
      const t = setTimeout(() => {
        if (!done.current) { setFailed(true); setMsg("This invite link has expired or was already used. Ask a manager to send a new one."); }
      }, 10000);
      return () => clearTimeout(t);
    }
    const { data: sub } = supa.auth.onAuthStateChange((evt, session) => { if (session && (evt === "SIGNED_IN" || evt === "INITIAL_SESSION")) finish(); });
    supa.auth.getSession().then(({ data }) => { if (data.session) finish(); });
    const t = setTimeout(() => {
      if (!done.current) { setFailed(true); setMsg("This invite link has expired or was already used. Ask a manager to send a new one, or sign in with your email."); }
    }, 8000);
    return () => { clearTimeout(t); sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (cool <= 0) return;
    const t = setInterval(() => setCool((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cool]);

  async function uploadPfp(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Pick an image file for the picture."); return; }
    if (f.size > 5 * 1024 * 1024) { setError("Picture must be under 5 MB."); return; }
    setUpping(true);
    setError("");
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
      // never notified, never mirrored) — the path is saved with the profile below.
      setAvatar({ path: dj.path });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Picture upload failed.");
    } finally {
      setUpping(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[a-z0-9._-]{3,40}$/i.test(name.trim())) { setError("Name: 3–40 letters, numbers, dots or dashes."); return; }
    if (!phone.trim()) { setError("Phone number is required."); return; }
    setBusy(true);
    setError("");
    const r = await fetch("/api/profile", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: name.trim(), phone: phone.trim(), ...(avatar ? { avatar_path: avatar.path } : {}) })
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error ?? "Couldn't save details."); return; }
    sendCode();
  }

  async function sendCode() {
    if (cool > 0) return;
    setError("");
    // Code goes through OUR smtp (Supabase never emails for this app).
    const r = await fetch("/api/auth/otp-code", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "send" })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setError(d.error ?? "Couldn't send the code — try again in a minute."); return; }
    setCool(60);
    setCode("");
    setPhase("verify");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { setError("Enter the 6-digit code."); return; }
    setBusy(true);
    setError("");
    const r = await fetch("/api/auth/otp-code", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "check", code: code.trim() })
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error ?? "Wrong or expired code — check it and try again."); return; }
    setPhase("done");
    window.location.replace("/drive");
  }

  const underline = "w-full min-h-[44px] mt-1 bg-transparent text-[18px] text-ink border-0 border-b border-[#8f8f9a] focus:border-b-2 focus:border-brand focus:outline-none rounded-none px-0";

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-canvas">
      <div className="max-w-md w-full rounded-[24px] bg-surface p-8 sm:p-10 shadow-win">
        <div className="mx-auto w-fit"><Logo size={52} /></div>
        <h1 className="mt-4 text-[22px] font-medium text-center">Welcome to Eiden</h1>

        {phase === "signin" && (
          <>
            <p className="mt-2 text-sm text-muted text-center" role="status">{msg}</p>
            {failed && <a href="/login" className="mt-6 flex min-h-[44px] items-center justify-center px-5 rounded-md bg-brand text-white text-sm font-medium">Go to sign in</a>}
          </>
        )}

        {phase === "details" && (
          <form className="mt-6 flex flex-col gap-5" onSubmit={saveDetails}>
            <p className="text-[13.5px] text-muted text-center">Signing in as <strong className="text-ink">{email}</strong>. Tell us who you are:</p>
            <div>
              <label className="block text-[14px] text-muted" htmlFor="ob-name">Your name</label>
              <input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoComplete="username" className={underline} />
            </div>
            <div>
              <label className="block text-[14px] text-muted" htmlFor="ob-phone">Phone number</label>
              <input id="ob-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} required autoComplete="tel" placeholder="+…" className={underline} />
            </div>
            <div>
              <span className="block text-[14px] text-muted">Profile picture <span className="text-[12px]">(optional)</span></span>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={upping}
                className="mt-2 min-h-[44px] px-4 rounded-md border border-line text-sm hover:bg-tint disabled:opacity-60">
                {upping ? "Uploading…" : avatar ? "Change picture ✓" : "Choose picture"}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Choose profile picture" onChange={(e) => uploadPfp(e.target.files)} />
            </div>
            {error && <p className="text-[14px] text-danger" role="alert">{error}</p>}
            <button disabled={busy}
              className="min-h-[44px] py-3 w-full rounded-[6px] bg-brand text-white text-[16px] tracking-wide uppercase hover:brightness-110 transition disabled:opacity-60">
              {busy ? "Saving…" : "Continue"}
            </button>
          </form>
        )}

        {phase === "verify" && (
          <form className="mt-6 flex flex-col" onSubmit={verify}>
            <p className="text-[13.5px] text-muted text-center">Last step — prove it's really you. We sent a 6-digit code to <strong className="text-ink">{email}</strong>.</p>
            <div className="mt-5">
              <label className="block text-[14px] text-muted" htmlFor="ob-code">6-digit code</label>
              <input id="ob-code" inputMode="numeric" autoComplete="one-time-code" placeholder="••••••"
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6} className={`${underline} tracking-[0.5em] text-center`} />
            </div>
            {error && <p className="text-[14px] text-danger mt-4" role="alert">{error}</p>}
            <button disabled={busy || code.trim().length !== 6}
              className="mt-6 min-h-[44px] py-3 w-full rounded-[6px] bg-brand text-white text-[16px] tracking-wide uppercase hover:brightness-110 transition disabled:opacity-60">
              {busy ? "Verifying…" : "Verify & enter"}
            </button>
            <button type="button" disabled={cool > 0} onClick={sendCode} className="mt-3 min-h-[44px] text-[14px] text-muted underline disabled:opacity-60 disabled:no-underline">
              {cool > 0 ? `Resend code in ${cool}s` : "Resend code"}
            </button>
          </form>
        )}

        {phase === "done" && <p className="mt-4 text-sm text-muted text-center" role="status">You're in — taking you to your drive…</p>}
      </div>
    </main>
  );
}
