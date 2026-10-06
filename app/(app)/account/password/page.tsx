"use client";
import { useState } from "react";
import { browserClient } from "@/lib/supabase-client";

export default function PasswordPage() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setMsg("");
    if (pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (pw !== pw2) { setErr("Passwords don't match."); return; }
    setBusy(true);
    const { error } = await browserClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(error.message);
    else { setMsg("Password saved. You can now sign in with email + password."); setPw(""); setPw2(""); }
  }

  const field = "w-full min-h-[44px] mt-1 bg-transparent text-[16px] text-ink border-0 border-b border-[#8f8f9a] focus:border-b-2 focus:border-brand focus:outline-none rounded-none px-0";

  return (
    <section className="px-1 pt-1 max-w-md">
      <h1 className="page-title">Set password</h1>
      <p className="text-sm text-muted mt-1">Optional. With a password you can sign in with email + password instead of waiting for an email link.</p>
      <form onSubmit={save} className="card mt-4 p-5 flex flex-col gap-4">
        <div>
          <label htmlFor="npw" className="block text-[13px] text-muted">New password (min 8 characters)</label>
          <input id="npw" type={show ? "text" : "password"} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} className={field} />
        </div>
        <div>
          <label htmlFor="npw2" className="block text-[13px] text-muted">Confirm password</label>
          <input id="npw2" type={show ? "text" : "password"} required autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8} className={field} />
        </div>
        <label className="text-[13px] text-muted flex items-center gap-2">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="size-5 accent-[#5b3fd0]" /> Show passwords
        </label>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        {msg && <p className="text-sm text-green-700" role="status">{msg}</p>}
        <button disabled={busy} className="min-h-[44px] rounded-md bg-brand text-white text-sm font-medium disabled:opacity-50">
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </section>
  );
}
