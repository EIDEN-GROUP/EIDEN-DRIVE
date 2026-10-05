"use client";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <section className="max-w-md mx-auto">
      <p className="pill inline-block px-3 py-1 border border-[var(--e-line-strong)]">Eiden Group · secure sign-in</p>
      <h1 className="font-display text-4xl mt-2">Sign in to <em className="font-serif italic">Eiden-Drive.</em></h1>
      {!sent ? (
        <form className="mt-4 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
          <label className="text-sm" htmlFor="email">Work email (Google SSO preferred)</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="min-h-[44px] px-4 rounded-2xl border bg-white" placeholder="you@eiden-group.com" />
          <button className="min-h-[44px] rounded-2xl bg-teal-600 text-cream-50">Continue with magic link</button>
          <a href="/drive" className="text-xs underline text-center min-h-[44px] grid place-items-center">Continue with Google (wired with .env)</a>
        </form>
      ) : <p className="text-sm mt-4" role="status">Check {email} for the sign-in link. MFA is enforced by Supabase Auth.</p>}
    </section>
  );
}
