"use client";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase-client";
import Logo from "@/components/ui/Logo";

// Landing page for invite emails. Supabase's invite link returns the session in the URL hash,
// which only the browser can read — the client library picks it up and stores the session cookie.
export default function Welcome() {
  const [msg, setMsg] = useState("Signing you in…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supa = browserClient();
    let done = false;
    const go = () => { if (!done) { done = true; window.location.replace("/drive"); } };
    const { data: sub } = supa.auth.onAuthStateChange((evt, session) => { if (session && (evt === "SIGNED_IN" || evt === "INITIAL_SESSION")) go(); });
    supa.auth.getSession().then(({ data }) => { if (data.session) go(); });
    const t = setTimeout(() => {
      if (!done) { setFailed(true); setMsg("This invite link has expired or was already used. Ask a manager to send a new one, or sign in with your email."); }
    }, 8000);
    return () => { clearTimeout(t); sub.subscription.unsubscribe(); };
  }, []);

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-canvas">
      <div className="max-w-sm w-full text-center rounded-[24px] bg-surface p-10 shadow-win">
        <div className="mx-auto w-fit"><Logo size={56} /></div>
        <h1 className="mt-5 text-[22px] font-medium">Welcome to Eiden</h1>
        <p className="mt-2 text-sm text-muted" role="status">{msg}</p>
        {failed && <a href="/login" className="mt-6 inline-flex min-h-[44px] items-center px-5 rounded-md bg-brand text-white text-sm font-medium">Go to sign in</a>}
      </div>
    </main>
  );
}
