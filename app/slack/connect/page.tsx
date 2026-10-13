import ConnectClient from "./ConnectClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect Slack — Eiden Drive" };

// Public landing for the Slack pairing flow (the token is unguessable; the
// POST still requires an Eiden session and consumes the token server-side).
export default function SlackConnectPage({ searchParams }: { searchParams: { token?: string; workspace?: string; user?: string } }) {
  const token = searchParams.token ?? "";
  const workspace = searchParams.workspace ?? "";
  const user = searchParams.user ?? "";
  if (!token || !workspace || !user) {
    return (
      <main className="min-h-dvh grid place-items-center p-4 bg-surface text-ink">
        <div className="w-full max-w-md rounded-2xl border border-line p-6">
          <p className="text-[20px] font-bold text-brand">Eiden Drive</p>
          <p className="mt-2 text-[14px] text-muted">This link is incomplete — start over from Slack with <code>/eiden-drive</code>.</p>
        </div>
      </main>
    );
  }
  return <ConnectClient token={token} workspace={workspace} user={user} />;
}
