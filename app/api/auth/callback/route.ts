export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

// Supabase Auth callback (magic link + Google SSO). NOT the Drive refresh-token flow.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  // Open-redirect guard: only same-origin relative paths. Anything else → /drive.
  const raw = url.searchParams.get("next") ?? "/drive";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/drive";
  if (code) {
    const supa = createRouteHandlerClient({ cookies });
    await supa.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, req.url));
}
