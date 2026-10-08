export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

// Auth callback: OAuth (?code=…) AND our SMTP links (?token_hash=…&type=…).
// Supabase never sends email for this app — links are minted server-side
// (generateLink) and mailed through our own SMTP. NOT the Drive token flow.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  // Open-redirect guard: only same-origin relative paths. Anything else → /drive.
  const raw = url.searchParams.get("next") ?? "/drive";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/drive";
  const supa = createRouteHandlerClient({ cookies });
  if (code) {
    await supa.auth.exchangeCodeForSession(code);
  } else if (token_hash && (type === "magiclink" || type === "invite" || type === "recovery")) {
    // Single-use, expiring server-side. Wrong/used links just land signed-out.
    await supa.auth.verifyOtp({ token_hash, type: type as "magiclink" });
  }
  return NextResponse.redirect(new URL(next, req.url));
}
