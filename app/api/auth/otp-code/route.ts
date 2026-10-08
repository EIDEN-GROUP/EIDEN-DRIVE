export const dynamic = "force-dynamic";

import { z } from "zod";
import { createClient } from "@/lib/supabase-server";
import { getProfile } from "@/lib/roles";
import { sendOtpCode, checkOtpCode } from "@/lib/email-otp";
import { parseJson } from "@/lib/http";

const Body = z.object({ action: z.enum(["send", "check"]), code: z.string().max(10).optional() });

// Signed-in members only — and the code always goes to YOUR OWN inbox.
// The session email is the address; there is no way to send codes elsewhere.
export async function POST(req: Request) {
  const me = await getProfile();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  const supa = createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user?.email) return Response.json({ error: "no email on this session" }, { status: 400 });
  if (p.data.action === "send") {
    const r = await sendOtpCode(
      user.email, "onboarding", "Your Eiden verification code", "Verify it's you",
      "Enter this code to finish setting up your Eiden Drive account:"
    );
    if (!r.ok) return Response.json({ error: r.error }, { status: 502 });
    return Response.json({ ok: true });
  }
  const r = await checkOtpCode(user.email, "onboarding", p.data.code ?? "");
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ ok: true });
}
