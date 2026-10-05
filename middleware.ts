import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

// Login requirement: every page + API needs a session, except auth surfaces + static assets.
const PUBLIC = [
  "/login",
  "/api/auth/callback",
  "/api/auth/google",
  "/manifest.json",
  "/sw.js",
  "/logo.png",
  "/logo.svg",
  "/favicon.ico"
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/_next/") || pathname.includes(".")) {
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
