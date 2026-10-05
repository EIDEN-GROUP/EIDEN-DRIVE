export const dynamic = "force-dynamic";

// Step 2: Google redirects here with ?code=... — we exchange it for tokens and
// display the refresh_token ONCE so you can paste it into Vercel env.
// Tokens are NEVER logged or stored in the DB by this route.
import { GOOGLE_REDIRECT_URI } from "@/lib/google-auth";
import { logAudit } from "@/lib/audit";
import { getProfile } from "@/lib/roles";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) return new Response(`Google refused: ${err}. See docs/10-google-oauth-refresh-token.md § troubleshooting.`, { status: 400 });
  if (!code) return new Response("Missing ?code= — open /api/auth/google first.", { status: 400 });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: GOOGLE_REDIRECT_URI(),
      grant_type: "authorization_code"
    })
  });
  const tok = (await res.json()) as { refresh_token?: string; access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !tok.refresh_token) {
    return new Response(
      `Exchange failed: ${tok.error ?? res.status} — ${tok.error_description ?? "no refresh_token returned. Re-open /api/auth/google (prompt=consent is already set) or revoke old grant at myaccount.google.com/permissions and retry."}`,
      { status: 400 }
    );
  }

  const me = await getProfile();
  if (me) await logAudit({ actor: me.id, actor_name: me.username, action: "edit", req, detail: { panel: "google-oauth", event: "refresh-token-issued" } });
  // NOTE: access_token intentionally NOT shown. Only the refresh token is needed for .env.

  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EIDEN-DRIVE — refresh token</title>
<style>body{font-family:system-ui;background:#122620;color:#FEFFF8;display:grid;place-items:center;min-height:100vh;margin:0}
.card{max-width:640px;background:#0E1B17;border:1px solid #CFC292;padding:28px;border-radius:16px}
code{display:block;background:#000;color:#CFC292;padding:14px;border-radius:10px;word-break:break-all;user-select:all}
.warn{color:#ffc107;font-size:13px}</style></head><body><div class="card">
<h2>Copy this into Vercel env as GOOGLE_REFRESH_TOKEN</h2>
<p class="warn">Shown ONCE. Never share it in chat/email. After saving, redeploy and re-opening this URL will stop working once you remove APP_SETUP_KEY.</p>
<code id="t">${tok.refresh_token.replace(/</g, "&lt;")}</code>
<p><button onclick="navigator.clipboard.writeText(document.getElementById('t').textContent)">Copy</button></p>
<p>Next: Vercel → drive.eiden-group.com project → Settings → Environment Variables → add GOOGLE_REFRESH_TOKEN → Redeploy. Then delete this test or keep it admin-gated. Full steps: docs/10-google-oauth-refresh-token.md</p>
</div></body></html>`,
    { headers: { "content-type": "text/html" } }
  );
}
