import type { EmailProvider, SendEmailInput, SendResult } from "./provider.ts";
import { CONFIG } from "../config.ts";

export const brevo: EmailProvider = {
  name: "brevo",
  async send(i: SendEmailInput): Promise<SendResult> {
    const key = Deno.env.get("BREVO_API_KEY");
    if (!key) return { ok: false, status: 0, error: "BREVO_API_KEY not set", rateLimited: true };
    const body = {
      sender: { name: Deno.env.get("FROM_NAME") || CONFIG.fromName, email: Deno.env.get("FROM_EMAIL") || CONFIG.fromEmail },
      replyTo: CONFIG.replyTo ? { email: CONFIG.replyTo } : undefined,
      to: [{ email: i.to.email, name: i.to.name || undefined }],
      subject: i.subject, htmlContent: i.html, textContent: i.text,
      headers: i.headers, tags: i.tags,
    };
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "api-key": key, "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(body),
    });
    if (r.ok) { const j = await r.json().catch(() => ({})); return { ok: true, id: j.messageId }; }
    const txt = await r.text().catch(() => "");
    // 429 = Brevo's rate/daily limit. 402 = plan limit reached. Either way: stop for today.
    return { ok: false, status: r.status, error: txt.slice(0, 300), rateLimited: r.status === 429 || r.status === 402 };
  },
};
