import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/supabase-admin";
import { sendMail } from "@/lib/mail";

// Our own 6-digit email codes (SMTP-sent). Used where Supabase can't help:
// post-invite step-up proof of inbox. Sessions ALWAYS still come from Supabase
// token exchanges — these codes prove ownership, never mint access.
const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

function hash(code: string, email: string): string {
  return createHash("sha256").update(`${email.toLowerCase()}:${code}`).digest("hex");
}

export async function sendOtpCode(email: string, purpose: string, subject: string, title: string, introHtml: string): Promise<{ ok: boolean; error?: string }> {
  const db = adminClient();
  const clean = email.trim().toLowerCase();
  // Server-side resend throttle: one live code per minute per purpose.
  const { data: recent } = await db.from("email_otps").select("id,created_at").eq("email", clean).eq("purpose", purpose).eq("consumed", false).order("created_at", { ascending: false }).limit(1);
  const last = (recent as { created_at: string }[] | null)?.[0];
  if (last && Date.now() - new Date(last.created_at).getTime() < 60_000) {
    return { ok: false, error: "a code was just sent — wait a minute before asking again" };
  }
  await db.from("email_otps").update({ consumed: true }).eq("email", clean).eq("purpose", purpose).eq("consumed", false);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await db.from("email_otps").insert({
    email: clean, purpose, code_hash: hash(code, clean),
    expires_at: new Date(Date.now() + TTL_MS).toISOString()
  });
  if (error) return { ok: false, error: error.message };
  return sendMail(
    clean, subject, title,
    `<p style="margin:0 0 12px;">${introHtml}</p>
     <p style="margin:0 0 12px;font-size:32px;font-weight:700;letter-spacing:8px;color:#5b3fd0;">${code}</p>
     <p style="margin:0;color:#6f6f7d;font-size:13px;">Valid 10 minutes. Never share it — Eiden staff will never ask for it.</p>`
  );
}

export async function checkOtpCode(email: string, purpose: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const clean = email.trim().toLowerCase();
  if (!/^\d{6}$/.test(code.trim())) return { ok: false, error: "enter the 6-digit code" };
  const db = adminClient();
  const { data } = await db.from("email_otps").select("id,code_hash,attempts,expires_at,consumed")
    .eq("email", clean).eq("purpose", purpose).eq("consumed", false)
    .order("created_at", { ascending: false }).limit(1);
  const row = (data as { id: string; code_hash: string; attempts: number; expires_at: string }[] | null)?.[0];
  if (!row) return { ok: false, error: "no active code — request a new one" };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.from("email_otps").update({ consumed: true }).eq("id", row.id);
    return { ok: false, error: "code expired — request a new one" };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await db.from("email_otps").update({ consumed: true }).eq("id", row.id);
    return { ok: false, error: "too many wrong tries — request a new code" };
  }
  // Constant-shape compare (timingSafeEqual needs equal lengths — hashes qualify).
  const want = Buffer.from(row.code_hash, "hex");
  const got = Buffer.from(hash(code.trim(), clean), "hex");
  const match = want.length === got.length && timingSafeEqual(want, got);
  if (!match) {
    await db.from("email_otps").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return { ok: false, error: "wrong code — check it and try again" };
  }
  await db.from("email_otps").update({ consumed: true }).eq("id", row.id);
  return { ok: true };
}
