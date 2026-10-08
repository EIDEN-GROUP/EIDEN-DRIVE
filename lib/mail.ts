import nodemailer, { type Transporter } from "nodemailer";

// Self-hosted SMTP — every Eiden email goes through YOUR mail server, never
// Supabase's shared sender. Secure by construction:
//   - port 465 = implicit TLS; anything else forces STARTTLS (requireTLS)
//   - auth only ever runs inside the encrypted session
//   - 15 s timeout so a dead mail server degrades to a clear error, not a hang
// Required env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
// Works identically on localhost and the domain — the only difference is which
// server the env points at (use your domain mailbox in production).

export function smtpConfigured(): boolean {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  return !!(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM);
}

export function smtpStatus(): { configured: boolean; hint: string } {
  if (smtpConfigured()) {
    return {
      configured: true,
      hint: `sending as ${process.env.SMTP_FROM} via ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`
    };
  }
  return {
    configured: false,
    hint: "set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in Vercel env, then redeploy"
  };
}

let tx: Transporter | null = null;
function transport(): Transporter {
  if (tx) return tx;
  const port = Number(process.env.SMTP_PORT);
  tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // implicit TLS on 465; STARTTLS below otherwise
    requireTLS: port !== 465, // refuse plaintext auth on submission ports
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000
  });
  return tx;
}

// Brand shell shared by every Eiden email: violet system theme, readable in
// light AND dark mail clients (explicit colors, no transparency tricks).
export function brandMail(title: string, bodyHtml: string): { html: string; text: string } {
  const text = `${title}\n\n${bodyHtml.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()}\n\n— Eiden Drive`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f2fb;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2fb;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e2f5;">
<tr><td style="background:#5b3fd0;padding:24px 32px;">
<span style="display:inline-block;width:36px;height:36px;border-radius:10px;background:#ffffff;color:#5b3fd0;font-weight:700;font-size:20px;line-height:36px;text-align:center;">E</span>
<span style="color:#ffffff;font-size:19px;font-weight:600;margin-left:10px;vertical-align:middle;">Eiden Drive</span>
</td></tr>
<tr><td style="padding:28px 32px;color:#23232e;font-size:15px;line-height:1.6;">
<p style="margin:0 0 12px;font-size:19px;font-weight:600;">${title}</p>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 32px 24px;color:#6f6f7d;font-size:12px;border-top:1px solid #e6e2f5;">
If you didn't ask for this, ignore it — nothing changes without your action.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  return { html, text };
}

export async function sendMail(to: string, subject: string, title: string, bodyHtml: string): Promise<{ ok: boolean; error?: string }> {
  if (!smtpConfigured()) {
    return { ok: false, error: "email is not configured — " + smtpStatus().hint };
  }
  try {
    const { html, text } = brandMail(title, bodyHtml);
    await transport().sendMail({ from: process.env.SMTP_FROM, to, subject, text, html });
    return { ok: true };
  } catch (e) {
    const m = e instanceof Error ? e.message : "send failed";
    if (/auth|credential|login|535|534/i.test(m)) {
      return { ok: false, error: "SMTP rejected the username/password — check SMTP_USER / SMTP_PASS (app passwords for Gmail/Outlook)" };
    }
    if (/timeout|timed out|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(m)) {
      return { ok: false, error: `can't reach the mail server ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} — check host/port and firewall` };
    }
    if (/certificate|self signed|SECURE|TLS|STARTTLS/i.test(m)) {
      return { ok: false, error: "TLS to the mail server failed — use port 465 (SSL) or 587 (STARTTLS), never port 25" };
    }
    return { ok: false, error: m };
  }
}
