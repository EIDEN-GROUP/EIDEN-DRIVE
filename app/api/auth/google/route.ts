export const dynamic = "force-dynamic";

// Step 1 of refresh-token flow. Open https://drive.eiden-group.com/api/auth/google
// while logged in as Admin/Manager -> redirects to Google consent (fileos@eiden-group.com).
// Google returns to /api/auth/google/callback?code=... which shows the refresh token ONCE.
import { getProfile } from "@/lib/roles";
import { GOOGLE_REDIRECT_URI, GOOGLE_SCOPES } from "@/lib/google-auth";

export async function GET(req: Request) {
  const me = await getProfile();
  const url = new URL(req.url);
  const setupKey = url.searchParams.get("key") ?? "";

  const allowSetupKey = process.env.APP_SETUP_KEY && setupKey === process.env.APP_SETUP_KEY;
  const allowAdmin = me && (me.role === "admin" || me.role === "manager");
  if (!allowAdmin && !allowSetupKey) {
    return new Response(
      "Forbidden: sign in as Admin/Manager first, or open with ?key=YOUR_APP_SETUP_KEY. See docs/10-google-oauth-refresh-token.md.",
      { status: 403 }
    );
  }

  const cid = process.env.GOOGLE_CLIENT_ID;
  if (!cid) return new Response("Missing GOOGLE_CLIENT_ID env.", { status: 500 });

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", cid);
  auth.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI());
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  auth.searchParams.set("access_type", "offline"); // <-- this makes Google issue a refresh_token
  auth.searchParams.set("prompt", "consent"); // <-- forces re-consent so token is returned even if granted before
  const state = crypto.randomUUID();
  auth.searchParams.set("state", state);

  // State is bound to this browser by an httpOnly cookie; the callback refuses anything without it.
  return new Response(null, {
    status: 302,
    headers: {
      location: auth.toString(),
      "set-cookie": `eiden_oauth_state=${state}; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
    }
  });
}
