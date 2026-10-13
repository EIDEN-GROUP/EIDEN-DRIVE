"use client";
import { useEffect, useState } from "react";

type Status =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "ready"; workspace: string; slack_user: string; signed_in: boolean; signed_in_as: string | null; already_linked: boolean }
  | { kind: "done"; disconnected?: boolean };

/** Connect landing: confirms + binds the caller's SIGNED-IN Eiden account to
 *  the Slack identity in the pairing link. Never trusts IDs alone — the POST
 *  requires a session and re-verifies the single-use token server-side. */
export default function ConnectClient({ token, workspace, user }: { token: string; workspace: string; user: string }) {
  const [st, setSt] = useState<Status>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    fetch(`/api/slack/connect?token=${encodeURIComponent(token)}&workspace=${encodeURIComponent(workspace)}&user=${encodeURIComponent(user)}`)
      .then((r) => r.json().catch(() => ({ ok: false, error: "Couldn't check the link." })))
      .then((d) => {
        if (dead) return;
        if (!d.ok) setSt({ kind: "error", error: d.error ?? "This link is invalid." });
        else setSt({ kind: "ready", workspace: d.workspace, slack_user: d.slack_user, signed_in: !!d.signed_in, signed_in_as: d.signed_in_as, already_linked: !!d.already_linked });
      })
      .catch(() => { if (!dead) setSt({ kind: "error", error: "Couldn't reach the server." }); });
    return () => { dead = true; };
  }, [token, workspace, user]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const r = await fetch("/api/slack/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setSt({ kind: "error", error: (d as { error?: string }).error ?? "Couldn't save the link." });
      return;
    }
    setSt({ kind: "done", disconnected: !!(d as { disconnected?: boolean }).disconnected });
  }

  return (
    <main className="min-h-dvh grid place-items-center p-4 bg-surface text-ink">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-pop p-6">
        <p className="text-[20px] font-bold text-brand">Eiden Drive</p>
        <h1 className="mt-1 text-[17px] font-semibold">Connect Slack</h1>
        {st.kind === "loading" && <p className="mt-4 text-[14px] text-muted" role="status">Checking the link…</p>}
        {st.kind === "error" && (
          <div>
            <p className="mt-4 text-[14px] text-danger" role="alert">{st.error}</p>
            <a href="/drive" className="mt-4 inline-block min-h-[44px] px-4 rounded-lg border border-line text-sm leading-[44px] hover:bg-tint">Back to Eiden Drive</a>
          </div>
        )}
        {st.kind === "ready" && !st.signed_in && (
          <div>
            <p className="mt-4 text-[14px]">Sign in to your Eiden Drive account first — the signed-in account is what gets connected to Slack user <span className="font-mono">{st.slack_user}</span>.</p>
            <a href={`/login?next=${encodeURIComponent(`/slack/connect?token=${token}&workspace=${encodeURIComponent(workspace)}&user=${encodeURIComponent(user)}`)}`}
              className="mt-4 inline-block min-h-[44px] px-4 rounded-lg bg-brand text-white text-sm font-medium leading-[44px]">Sign in</a>
          </div>
        )}
        {st.kind === "ready" && st.signed_in && !st.already_linked && (
          <div>
            <p className="mt-4 text-[14px]">
              Link <strong>{st.signed_in_as}</strong> (Eiden Drive) to Slack user <span className="font-mono">{st.slack_user}</span>?
              The bot will then let you browse and share files <em>you</em> can access — nothing more.
            </p>
            <div className="mt-5 flex gap-2">
              <button disabled={busy} onClick={() => act({ token, workspace, user })}
                className="flex-1 min-h-[44px] rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50">
                {busy ? "Linking…" : "Connect accounts"}
              </button>
              <a href="/drive" className="min-h-[44px] px-4 rounded-lg border border-line text-sm leading-[44px] hover:bg-tint">Cancel</a>
            </div>
          </div>
        )}
        {st.kind === "ready" && st.signed_in && st.already_linked && (
          <div>
            <p className="mt-4 text-[14px]">Already connected — <strong>{st.signed_in_as}</strong> ⇄ <span className="font-mono">{st.slack_user}</span>.</p>
            <div className="mt-5 flex gap-2">
              <button disabled={busy} onClick={() => act({ disconnect: true, workspace, user })}
                className="flex-1 min-h-[44px] rounded-lg border border-danger/40 text-danger text-sm disabled:opacity-50">
                {busy ? "Working…" : "Disconnect"}
              </button>
              <a href="/drive" className="min-h-[44px] px-4 rounded-lg border border-line text-sm leading-[44px] hover:bg-tint">Back to Drive</a>
            </div>
          </div>
        )}
        {st.kind === "done" && !st.disconnected && (
          <div>
            <p className="mt-4 text-[14px]" role="status">Connected! Return to Slack and run <code>/eiden-drive</code> to browse and share your files.</p>
            <a href="/drive" className="mt-4 inline-block min-h-[44px] px-4 rounded-lg border border-line text-sm leading-[44px] hover:bg-tint">Back to Eiden Drive</a>
          </div>
        )}
        {st.kind === "done" && st.disconnected && (
          <div>
            <p className="mt-4 text-[14px]" role="status">Disconnected. Slack will prompt you to connect again when needed.</p>
            <a href="/drive" className="mt-4 inline-block min-h-[44px] px-4 rounded-lg border border-line text-sm leading-[44px] hover:bg-tint">Back to Eiden Drive</a>
          </div>
        )}
      </div>
    </main>
  );
}
