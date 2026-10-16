"use client";
import { useState } from "react";

type State = "idle" | "sending" | "sent" | "error";

export default function AccessForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    try {
      const r = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), message: message.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Couldn't send the request.");
      }
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the request.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="card p-6 sm:p-7" role="status">
        <p className="text-[16px] font-medium">Request received.</p>
        <p className="mt-2 text-[14px] text-muted leading-relaxed">
          A manager will review it and invite you by email if your team is onboard. Existing members can sign in directly.
        </p>
      </div>
    );
  }

  const input = "w-full min-h-[48px] mt-1.5 rounded-lg border border-line bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none";
  return (
    <form onSubmit={submit} className="card p-6 sm:p-7" aria-label="Request access to EIDEN-DRIVE">
      <div>
        <label htmlFor="acc-name" className="text-[14px] font-medium">Your name</label>
        <input id="acc-name" required autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Amina Yusuf" className={input} />
      </div>
      <div className="mt-4">
        <label htmlFor="acc-email" className="text-[14px] font-medium">Work email</label>
        <input id="acc-email" type="email" required autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com" className={input} />
      </div>
      <div className="mt-4">
        <label htmlFor="acc-msg" className="text-[14px] font-medium">Team and role <span className="text-muted font-normal">(optional)</span></label>
        <textarea id="acc-msg" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="Finance, accountant — monthly close and approvals…" className={`${input} py-3 resize-y`} />
      </div>
      {error && <p className="mt-3 text-[14px] text-danger" role="alert">{error}</p>}
      <button disabled={state === "sending"}
        className="mt-5 min-h-[52px] w-full rounded-lg bg-brand text-white text-[15.5px] font-medium hover:brightness-110 active:brightness-95 transition disabled:opacity-60">
        {state === "sending" ? "Sending…" : "Request access"}
      </button>
      <p className="mt-3 text-[12.5px] text-muted leading-relaxed">
        One request per email. We only use these details to review access — see the <a className="underline" href="/privacy">Privacy Policy</a>.
      </p>
    </form>
  );
}
