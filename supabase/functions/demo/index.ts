// The demo funnel (subduction.art/demo): a promoter gets a test ticket by email, opens it, and "scans" it,
// so they see the whole thing from the fan's side and their own. Every sign-up is a sales lead in demo_leads.
// Self-contained on purpose (no shared imports). Makes no real tickets, orders or charges.
//   POST {a:"start", name, crew, email, phone}   save the lead + email the test ticket
//   GET  ?t=token                                the test ticket (for the link in the email)
//   GET  ?a=qr&t=token                           its QR code
//   POST {a:"scan", t}                           mark it scanned, like the door app would
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import QRCode from "npm:qrcode@1.5.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = (Deno.env.get("SITE_URL") || "https://subduction.art").replace(/\/$/, "");
const FN = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/demo";
const CONTACT = "hello@subduction.art";
const TOKEN = /^[0-9a-f]{32}$/, EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const no = (m: string, s = 400) => json({ error: m }, s);
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b) => b.toString(16).padStart(2, "0")).join("");
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => ALPHA[b % 32]).join("");
async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
const ticketUrl = (t: string) => `${SITE}/demo.html?t=${t}`;
const pub = (l: Record<string, any>) => ({ token: l.token, code: l.code, name: l.full_name, crew: l.crew, email: l.email, phone: l.phone, scanned_at: l.scanned_at });

async function sendTicket(l: Record<string, any>) {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) { console.error("demo: BREVO_API_KEY not set"); return false; }
  const first = (l.full_name || "").trim().split(/\s+/)[0] || "there", by = l.crew || "Your crew";
  const F = "font-family:Arial,Helvetica,sans-serif", url = ticketUrl(l.token);
  const subject = "Your test ticket: Demo Night";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${subject}</title></head>
<body style="margin:0;background:#0a0a0a"><div style="display:none;max-height:0;overflow:hidden;opacity:0">This is what your buyers get the second they pay.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111110;border:1px solid #2b2927">
<tr><td style="padding:14px 24px;background:#b6ff00;${F};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#000;font-weight:bold">Test ticket · not a real show</td></tr>
<tr><td style="padding:26px 24px 6px;${F};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#9a958f">${esc(by)}</td></tr>
<tr><td style="padding:0 24px;${F};font-size:28px;line-height:1.15;font-weight:bold;color:#f4f1ee">Demo Night</td></tr>
<tr><td style="padding:14px 24px 0;${F};font-size:15px;line-height:1.6;color:#d9d5cf">Hi ${esc(first)}, you're in. This is the email your buyers get the second they pay, with your crew's name on it instead of ours.</td></tr>
<tr><td style="padding:20px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #2b2927;background:#0a0a0a"><tr>
<td width="132" style="padding:12px"><a href="${url}"><img src="${FN}?a=qr&t=${l.token}" width="120" height="120" alt="QR code for test ticket ${esc(l.code)}" style="display:block;border:0;background:#ffffff"></a></td>
<td style="padding:12px 12px 12px 0;${F};color:#f4f1ee"><div style="font-size:17px;font-weight:bold">General Admission</div><div style="font-size:13px;line-height:1.5;color:#9a958f">${esc(l.full_name || "")}</div>
<div style="font-family:Courier,monospace;font-size:18px;letter-spacing:2px;padding-top:6px">${esc(l.code)}</div></td></tr></table></td></tr>
<tr><td style="padding:22px 24px 0"><a href="${url}" style="display:block;background:#b6ff00;color:#000;${F};font-size:15px;font-weight:bold;text-align:center;text-decoration:none;padding:15px 12px;text-transform:uppercase;letter-spacing:1px">Open the ticket and scan it</a></td></tr>
<tr><td style="padding:22px 24px 26px;${F};font-size:12px;line-height:1.6;color:#6f6b66">You asked for this test ticket at subduction.art/demo. It's a one-time email. Don't want to hear from us? Reply "stop" or <a href="mailto:${CONTACT}?subject=unsubscribe" style="color:#9a958f">unsubscribe</a>.<br>Subduction · ${esc(await setting("mailing_address", "PO Box TBD, Bloomington, IL 61701"))}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Test ticket (not a real show): Demo Night, ${by}`, "", `Hi ${first}, you're in. This is the email your buyers get the second they pay, with your crew's name on it.`, "",
    `General Admission · ${l.full_name || ""}`, `Code ${l.code}`, "", "Open the ticket and scan it:", url, "",
    `You asked for this test ticket at subduction.art/demo. It's a one-time email. To stop hearing from us, reply "stop" or email ${CONTACT}.`, "Subduction"].join("\n");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: `${by} Tickets (demo)`.slice(0, 70), email: Deno.env.get("FROM_EMAIL") || CONTACT }, replyTo: { email: CONTACT },
      to: [{ email: l.email, name: l.full_name || undefined }], subject, htmlContent: html, textContent: text, tags: ["demo"],
      headers: { "List-Unsubscribe": `<mailto:${CONTACT}?subject=unsubscribe>` } }) });
  if (!r.ok) { console.error("demo: email failed", r.status, (await r.text().catch(() => "")).slice(0, 200)); return false; }
  await db.from("demo_leads").update({ emailed_at: new Date().toISOString() }).eq("id", l.id);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url), a = u.searchParams.get("a") || "", t = u.searchParams.get("t") || "";

  if (req.method === "GET" && a === "qr") {
    if (!TOKEN.test(t)) return no("Not found", 404);
    const png = await QRCode.toBuffer(ticketUrl(t), { type: "png", width: 440, margin: 2, errorCorrectionLevel: "M" });
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", ...CORS } });
  }
  if (req.method === "GET") {
    if (!TOKEN.test(t)) return no("Not found", 404);
    const { data: l } = await db.from("demo_leads").select("*").eq("token", t).maybeSingle();
    if (!l) return no("Not found", 404);
    if (!l.opened_at) await db.from("demo_leads").update({ opened_at: new Date().toISOString() }).eq("id", l.id);
    return json(pub(l));
  }
  if (req.method !== "POST") return no("Not allowed", 405);
  let b: Record<string, unknown>; try { b = await req.json(); } catch { return no("Bad request"); }

  if (b.a === "scan") {
    const tok = clean(b.t, 40);
    if (!TOKEN.test(tok)) return no("Not found", 404);
    const { data: l } = await db.from("demo_leads").select("*").eq("token", tok).maybeSingle();
    if (!l) return no("Not found", 404);
    const at = l.scanned_at || new Date().toISOString();
    if (!l.scanned_at) await db.from("demo_leads").update({ scanned_at: at }).eq("id", l.id);
    return json({ ...pub(l), scanned_at: at, again: !!l.scanned_at });
  }

  if (b.a !== "start") return no("Bad request");
  if (clean(b.website, 200)) return json({ ok: true });   // honeypot: bots fill it, people never see it
  const ipRaw = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0.0.0.0";
  const ip = await sha256(ipRaw + "|" + (await setting("ip_salt", "unset")) + "|demo");   // hashed, never stored raw
  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: ip });
  if ((n ?? 0) > 8) return no("Too many tries. Wait a minute and try again.", 429);

  const email = clean(b.email, 254).toLowerCase(), name = clean(b.name, 80), crew = clean(b.crew, 80);
  if (!name || name.split(/\s+/).length < 2) return no("Enter your full name (first and last).");
  if (!crew) return no("Enter your crew or promoter name.");
  if (!EMAIL_RE.test(email)) return no("Enter the email your test ticket should go to.");
  const digits = String(b.phone ?? "").replace(/\D/g, "");
  const phone = digits.length === 10 ? "+1" + digits : digits.length === 11 && digits[0] === "1" ? "+" + digits : digits.length >= 11 && digits.length <= 15 ? "+" + digits : "";
  if (!phone) return no("Enter a phone number we can reach you at.");

  let { data: l } = await db.from("demo_leads").select("*").eq("email", email).maybeSingle();
  if (l) {
    await db.from("demo_leads").update({ full_name: name, crew, phone }).eq("id", l.id);
    l = { ...l, full_name: name, crew, phone };
  } else {
    const ins = await db.from("demo_leads").insert({ email, full_name: name, crew, phone, token: hex(16), code: newCode(), ip_hash: ip }).select("*").single();
    if (ins.error || !ins.data) { console.error("demo: insert failed", ins.error?.message); return no("Couldn't set that up. Try again.", 500); }
    l = ins.data;
  }
  // One email per ten minutes per address, so the form can't be used to spam someone.
  const recent = l.emailed_at && Date.now() - new Date(l.emailed_at).getTime() < 10 * 60_000;
  const sent = recent ? true : await sendTicket(l);
  return json({ ...pub(l), sent });
});
