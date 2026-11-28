// "Message my crowd": a promoter writes to their own past buyers. Nothing here runs until the promoter
// presses Send on the review screen. The list never leaves the server, only a count does.
// Mail goes one-to-one through the Brevo provider. Nothing is written to email_queue.
import { db } from "./db.ts";
import { brevo } from "./email/brevo.ts";
import { CONFIG, SITE_URL } from "./config.ts";
import { unsubUrl, type Member } from "./templates.ts";
import { UNDERGROUND_EVENT_ID } from "./street.ts";

export const MAX_RECIPIENTS = 500;   // hard cap per send
const FN = (Deno.env.get("SUPABASE_URL") || "https://hxfuelulxsituzcgsvhg.supabase.co") + "/functions/v1";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export interface Crowd { subject: string; body: string; nextDate: string }
export function cleanCrowd(b: Record<string, unknown>): Crowd | { error: string } {
  const one = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);
  const subject = one(b.subject, 140).replace(/\s+/g, " "), body = one(b.body, 5000), nextDate = one(b.next_date, 60).replace(/\s+/g, " ");
  if (!subject) return { error: "Add a subject." };
  if (!body) return { error: "Write your message." };
  return { subject, body, nextDate };
}

export function postalAddress(): string {
  const a = String(CONFIG.mailingAddress || "").trim();
  return !a || /TBD/i.test(a) ? "" : a;
}

type Aud = { member: Member & { status: string }; };
// Unique emails from paid orders on this company's shows, then only the ones whose member row is active.
// Reads fresh every call, so someone who unsubscribed after the review screen is skipped at send time.
export async function audience(show: { id: string; slug: string; company_id: string }): Promise<Aud["member"][]> {
  if (show.id === UNDERGROUND_EVENT_ID || show.slug === "underground") return [];
  const emails = new Set<string>();
  for (let from = 0; from <= 20000; from += 1000) {
    const { data, error } = await db.from("ticket_orders").select("email").eq("event_id", show.id).eq("status", "paid").not("email", "is", null).order("created_at").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data || []) { const e = String(r.email || "").trim().toLowerCase(); if (e) emails.add(e); }
    if (!data || data.length < 1000) break;
  }
  const list = [...emails], out: Aud["member"][] = [];
  for (let i = 0; i < list.length; i += 100) {
    const { data, error } = await db.from("subscribers").select("id,email,first_name,access_token,unsubscribe_token,referral_code,confirmed_referrals,status").in("email", list.slice(i, i + 100)).eq("status", "active");
    if (error) throw new Error(error.message);
    for (const m of data || []) if (m.status === "active" && m.unsubscribe_token) out.push(m as Aud["member"]);
  }
  return out;
}

export function render(c: Crowd, companyName: string, showName: string, m: Member) {
  const addr = postalAddress(), unsub = unsubUrl(m);
  const why = `You're getting this because you bought a ticket to ${showName} from ${companyName}.`;
  const foot = addr ? `${companyName} · ${addr}` : companyName;
  const paras = c.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#000" bgcolor="#000000"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000"><tr><td align="center" style="padding:36px 16px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;color:#e9e9e9;font:16px/1.6 ${F}">
${c.nextDate ? `<tr><td style="padding-bottom:14px;font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:#888">Next date: ${esc(c.nextDate)}</td></tr>` : ""}
<tr><td style="padding-bottom:32px">${paras.map((p) => `<p style="margin:0 0 16px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</td></tr>
<tr><td style="padding-top:36px;border-top:1px solid #222;font-size:12px;line-height:1.7;color:#777">${esc(why)}<br><a href="${unsub}" style="color:#999">Unsubscribe</a> · ${esc(foot)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${c.nextDate ? `Next date: ${c.nextDate}\n\n` : ""}${paras.join("\n\n")}\n\n--\n${why}\nUnsubscribe: ${unsub}\n${foot}`;
  return { html, text };
}

export type SendOutcome = { sent: number; total: number; stopped: boolean };
// One-to-one, a few at a time. Stops at the first Brevo rate limit and says how far it got.
export async function sendCrowd(c: Crowd, companyName: string, showName: string, people: Member[]): Promise<SendOutcome> {
  let sent = 0, stopped = false;
  for (let i = 0; i < people.length && !stopped; i += 5) {
    const res = await Promise.all(people.slice(i, i + 5).map(async (m) => {
      const r = render(c, companyName, showName, m);
      return brevo.send({
        to: { email: m.email, name: m.first_name }, subject: c.subject, html: r.html, text: r.text, tags: ["crowd"], fromName: companyName.slice(0, 80),
        headers: {
          "List-Unsubscribe": `<${unsubUrl(m)}>, <mailto:${Deno.env.get("FROM_EMAIL") || "unsubscribe@" + new URL(SITE_URL).hostname}?subject=unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
    }));
    for (const r of res) { if (r.ok) sent++; else if (r.rateLimited) stopped = true; }
  }
  return { sent, total: people.length, stopped };
}
