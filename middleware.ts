import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

// Login requirement: every page + API needs a session, except auth surfaces + static assets.
// Machine endpoints (agent, Google webhook) have no browser session — they authenticate
// themselves INSIDE the route with a shared secret and fail closed if it is not configured.
const PUBLIC = [
  "/login",
  "/welcome",                  // invite landing; reads the session from the URL hash in the browser
  "/api/auth/callback",
  "/api/auth/google",          // start route self-gates (admin/manager session or setup key)
  "/api/agent",                // bearer AGENT_TOKEN (POST); GET self-gates with session
  "/api/drive/webhook",        // x-goog-channel-token
  "/manifest.json",
  "/sw.js",
  "/logo.png",
  "/logo.svg",
  "/favicon.ico"
];
const STATIC_EXT = /\.(?:png|jpe?g|svg|ico|webp|gif|css|js|map|json|txt|woff2?|ttf)$/i;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  // Static assets only — never let a dotted path bypass auth on an API route.
  if (pathname.startsWith("/_next/") || (!pathname.startsWith("/api/") && STATIC_EXT.test(pathname))) {
    return NextResponse.next();
  }
  const res = NextResponse.next();
  const supa = createMiddlewareClient({ req, res });
  const { data: { session } } = await supa.auth.getSession();
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
