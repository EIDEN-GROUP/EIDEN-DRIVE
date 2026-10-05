"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { browserClient } from "@/lib/supabase-client";
import Logo from "@/components/ui/Logo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const next = useSearchParams().get("next") ?? "/drive";

  async function magicLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    const supa = browserClient();
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}` }
    });
    if (error) { setError(error.message); setState("error"); }
    else setState("sent");
  }

  async function google() {
    const supa = browserClient();
    await supa.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}` }
    });
  }

  return (
    <section className="max-w-md mx-auto" aria-labelledby="login-title">
      <div className="card p-6 bg-white">
        <div className="flex items-center gap-3">
          <span className="rounded-xl overflow-hidden inline-block"><Logo size={40} /></span>
          <div>
            <p className="text-[11px] font-bold tracking-[.22em] uppercase text-teal-600">Eiden Group · secure sign-in</p>
            <h1 id="login-title" className="font-display text-3xl uppercase">Eiden-Drive</h1>
          </div>
        </div>

        {state === "sent" ? (
          <p className="text-sm mt-5" role="status">
            Check <strong>{email}</strong> for the sign-in link. It expires in 1 hour.
          </p>
        ) : (
          <form className="mt-5 flex flex-col gap-3" onSubmit={magicLink} noValidate={false}>
            <div>
              <label className="text-sm font-medium" htmlFor="email">Work email</label>
              <input id="email" name="email" type="email" required autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@eiden-group.com"
                aria-describedby="email-help"
                className="mt-1 w-full min-h-[44px] px-4 rounded-2xl border border-[var(--e-line-strong)] bg-white" />
              <p id="email-help" className="text-xs opacity-70 mt-1">We email you a one-time sign-in link. No password to remember.</p>
            </div>
            {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
            <button disabled={state === "sending"} className="min-h-[44px] rounded-2xl bg-teal-600 text-cream-50 font-semibold disabled:opacity-50">
              {state === "sending" ? "Sending…" : "Continue with email link"}
            </button>
            <div className="flex items-center gap-2 text-xs opacity-60" aria-hidden="true">
              <span className="flex-1 border-t" /><span>or</span><span className="flex-1 border-t" />
            </div>
            <button type="button" onClick={google} className="min-h-[44px] rounded-2xl border border-[var(--e-line-strong)] font-semibold">
              Continue with Google
            </button>
          </form>
        )}
        <p className="text-xs opacity-60 mt-4">Protected by Supabase Auth. Sessions are per-device; the secrets Vault needs a second factor.</p>
      </div>
    </section>
  );
}
