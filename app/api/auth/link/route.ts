export const dynamic = "force-dynamic";

import { z } from "zod";
import { adminClient, hasAdminClient } from "@/lib/supabase-admin";
import { sendMail } from "@/lib/mail";
import { parseJson } from "@/lib/http";

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(254), next: z.string().max(200).optional() });

// Public sign-in link, sent through OUR SMTP (never Supabase's sender).
// Always answers "check your email" — whether the address exists or not — so
// addresses can't be enumerated. Throttled per address.
const hits = new Map<string, number>();

export async function POST(req: Request) {
  const p = await parseJson(req, Body);
  if (p.error) return p.error;
  if (!hasAdminClient()) return Response.json({ ok: true }); // same shape either way
  const ok = { ok: true };
  const now = Date.now();
  const last = hits.get(p.data.email) ?? 0;
  if (now - last < 60_000) return Response.json(ok);
  hits.set(p.data.email, now);

  const db = adminClient();
  // Existence check that doesn't leak: resolve the auth user id first.
  const userId = await authIdFor(db, p.data.email);
  if (!userId) return Response.json(ok);
  const next = p.data.next && p.data.next.startsWith("/") && !p.data.next.startsWith("//") ? p.data.next : "/drive";
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const { data: link, error } = await db.auth.admin.generateLink({
    type: "magiclink", email: p.data.email, options: { redirectTo: `${origin}/api/auth/callback?next=${encodeURIComponent(next)}` }
  });
  if (error || !link?.properties?.hashed_token) return Response.json(ok);
  const url = `${origin}/api/auth/callback?token_hash=${link.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`;
  const sent = await sendMail(
    p.data.email, "Your Eiden Drive sign-in link", "Sign in to Eiden Drive",
    `<p style="margin:0 0 12px;">Click below — it signs you in directly, no password needed. It expires in 1 hour and works once.</p>
     <p style="margin:0 0 12px;"><a href="${url}" style="display:inline-block;background:#5b3fd0;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">Sign in to Eiden Drive</a></p>
     <p style="margin:0;color:#6f6f7d;font-size:13px;">Or paste this address into your browser:<br><span style="word-break:break-all;">${url}</span></p>`
  );
  if (!sent.ok) console.error("[smtp-link]", sent.error);
  return Response.json(ok);
}

// Auth user id by email (service role). Null when the address has no account.
async function authIdFor(db: ReturnType<typeof adminClient>, email: string): Promise<string | null> {
  // listUsers is paginated — fine at our scale; short-circuit on first hit.
  let page = 1;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 100) return null;
    page++;
  }
}
