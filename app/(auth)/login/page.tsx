"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { browserClient } from "@/lib/supabase-client";
import Logo from "@/components/ui/Logo";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const next = useSearchParams().get("next") ?? "/drive";
  // Inputs are rendered only after mount: browser extensions (password managers, autofill) add nodes/attributes to
  // form fields before React hydrates, which makes hydration fail ("initial UI does not match the server").
  // With nothing form-like in the server HTML there is nothing for them to mutate.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Resend cooldown: Supabase rate-limits OTP emails (429 "email rate limit exceeded").
  // One send per 60 s per browser + a clear message keeps users out of the limit.
  const COOLDOWN = 60;
  const [cool, setCool] = useState(0);
  useEffect(() => {
    const left = COOLDOWN - Math.floor((Date.now() - Number(localStorage.getItem("eiden-otp-at") ?? 0)) / 1000);
    if (left <= 0) return;
    setCool(left);
    const t = setInterval(() => setCool((c) => {
      if (c <= 1) { clearInterval(t); return 0; }
      return c - 1;
    }), 1000);
    return () => clearInterval(t);
  }, []);

  async function magicLink(e: React.FormEvent) {
    e.preventDefault();
    if (cool > 0) return;
    setState("sending");
    setError("");
    const supa = browserClient();
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}` }
    });
    if (error) {
      const m = error.message;
      if (/rate|too many|429|exceeded|after a while/i.test(m)) {
        setError("Too many sign-in emails sent — wait a few minutes, then try exactly once. Check spam too.");
      } else if (/signups? not allowed|not found|invalid login/i.test(m)) {
        setError("No account for this email yet. Ask a manager to invite you.");
      } else setError(m);
      setState("error");
    }
    else {
      localStorage.setItem("eiden-otp-at", String(Date.now()));
      setCool(COOLDOWN);
      setState("sent");
    }
  }

  async function google() {
    const supa = browserClient();
    await supa.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}` }
    });
  }

  return (
    <div className="font-material flex flex-col justify-center px-8 sm:px-14 lg:px-[72px] py-12">
      <div className="lg:hidden mx-auto mb-6"><Logo size={56} /></div>
      <h1 id="login-title" className="text-center text-[30px] font-medium text-[var(--login)] tracking-tight">Sign In Account</h1>

      {!mounted ? (
        <div className="mt-12 min-h-[330px]" aria-busy="true" aria-label="Loading sign-in form" />
      ) : state === "sent" ? (
        <p className="text-center text-[16px] mt-14 text-ink/80 leading-relaxed" role="status">
          Check <strong className="font-medium">{email}</strong> for your sign-in link.<br />
          <span className="text-muted text-[14px]">It expires in 1 hour.</span>
        </p>
      ) : (
        <form className="mt-12 flex flex-col" onSubmit={magicLink}>
          <div className="group">
            <label className="block text-[17px] text-muted" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} aria-describedby="email-help"
              className="w-full min-h-[44px] mt-1 bg-transparent text-[18px] text-ink border-0 border-b border-[#8f8f9a] focus:border-b-2 focus:border-[var(--login)] focus:outline-none transition-colors rounded-none px-0" />
            <p id="email-help" className="text-[12.5px] text-muted mt-2">We email you a one-time link. No password to remember.</p>
          </div>

          {error && <p className="text-[14px] text-danger mt-4" role="alert">{error}</p>}

            <button disabled={state === "sending" || cool > 0}
              className="mt-9 min-h-[44px] py-3 w-full rounded-[6px] bg-[var(--login)] text-white text-[17px] tracking-wide uppercase hover:brightness-110 active:brightness-95 transition disabled:opacity-60 shadow-[0_1px_2px_rgba(60,30,120,.25)]">
              {state === "sending" ? "Sending…" : cool > 0 ? `Resend in ${cool}s` : "Sign in"}
            </button>

          <div className="flex items-center gap-3 my-6 text-[13px] text-muted" aria-hidden="true">
            <span className="flex-1 border-t border-line" /><span>or</span><span className="flex-1 border-t border-line" />
          </div>

          <button type="button" onClick={google}
            className="min-h-[44px] py-3 w-full rounded-[6px] border border-[var(--login)] text-[var(--login)] text-[16px] hover:bg-tint transition-colors flex items-center justify-center gap-3">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
          </button>
        </form>
      )}

      <p className="text-center text-[15px] text-muted mt-10">
        No account yet? <span className="text-[var(--login)] border-b border-[var(--login)]">Ask a manager to invite you.</span>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center p-4 sm:p-8 bg-canvas">
      <section aria-labelledby="login-title"
        className="w-full max-w-[1020px] grid lg:grid-cols-2 rounded-[32px] bg-surface p-3.5 shadow-[0_30px_80px_-30px_rgba(40,20,90,.35)]">
        {/* Art panel */}
        <div className="relative hidden lg:block overflow-hidden rounded-[22px] bg-[#e6d7d4] min-h-[600px]" aria-hidden="true">
          <div className="absolute left-12 top-12 drop-shadow-[0_8px_16px_rgba(67,40,184,.25)]"><Logo size={72} /></div>
          <div className="absolute left-12 top-[44%] text-[var(--login)]">
            <p className="font-brand text-[64px] leading-none font-semibold tracking-tight">Eiden</p>
            <p className="font-brand text-[32px] leading-tight mt-1">Your files, one drive.</p>
          </div>
          <svg className="absolute inset-x-0 bottom-0 w-full" viewBox="0 0 480 300" preserveAspectRatio="none" height="300">
            <defs>
              <linearGradient id="red" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#d9341f" /><stop offset=".55" stopColor="#f7351b" /><stop offset="1" stopColor="#c8561f" /></linearGradient>
              <linearGradient id="gold" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#b9772c" /><stop offset=".5" stopColor="#e8c55f" /><stop offset="1" stopColor="#f3e49b" /></linearGradient>
              <linearGradient id="coral" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ee7a6a" /><stop offset="1" stopColor="#d85a45" stopOpacity=".5" /></linearGradient>
            </defs>
            <path d="M0 300V130C70 105 120 130 175 160 240 195 300 175 330 130 360 85 410 30 480 0V300Z" fill="#f6e4e3" />
            <path d="M0 210C60 150 120 150 190 195 250 225 300 200 335 140 365 85 420 40 480 10V120C440 150 395 210 360 250 320 290 250 270 200 252 130 226 70 232 20 270L0 285Z" fill="url(#gold)" opacity=".92" />
            <path d="M0 240C40 190 110 160 170 205 215 238 265 236 300 205 340 168 370 130 480 90V150C420 190 385 240 345 275 295 315 215 275 160 262 100 248 50 262 0 300Z" fill="url(#red)" />
            <path d="M0 215C60 180 110 190 150 210L190 236C130 228 70 240 0 280Z" fill="url(#coral)" />
            <path d="M0 300V268C130 262 330 250 480 214V300Z" fill="#fbe9e8" />
          </svg>
        </div>
        <Suspense fallback={null}><LoginForm /></Suspense>
      </section>
    </main>
  );
}
