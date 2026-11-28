// The demo funnel (subduction.art/demo): a promoter gets a test ticket by email, opens it, and "scans" it,
// so they see the whole thing from the fan's side and their own. Every sign-up is a sales lead in demo_leads.
// Self-contained on purpose (no shared imports). Makes no real tickets, orders or charges.
//   POST {a:"start", name, crew, email, phone}   save the lead + email the test ticket
//   GET  ?t=token                                the test ticket (for the link in the email)
//   GET  ?a=qr&t=token                           its QR code
//   POST {a:"scan", t}                           mark it scanned, like the door app would
//   POST {a:"claim", t, k?}                      open their promoter account: makes the crew and links their email as its owner.
//                                                With the key from the email link (proof the inbox is theirs) they're signed
//                                                straight in; without it they're emailed a one-tap sign-in button.
//   POST {a:"signin", email}                     email a promoter a one-tap sign-in button (no code to type). The link is the
//                                                same kind the promoter app already accepts (#invite=...), good once, for 20 minutes.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import QRCode from "npm:qrcode@1.5.4";

// Same rule as _shared/client_ip.mjs (this file imports nothing shared): cf-connecting-ip, else last x-forwarded-for hop, else x-real-ip.
const clientIp = (req: Request) => (req.headers.get("cf-connecting-ip") || "").split(",")[0].trim()
  || (req.headers.get("x-forwarded-for") || "").split(",").map((h) => h.trim()).filter(Boolean).pop()
  || (req.headers.get("x-real-ip") || "").trim() || "unknown";
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
const admins = async () => ((await setting<unknown>("admin_emails", [])) as unknown[]).map((e) => String(e).toLowerCase()).filter((e) => EMAIL_RE.test(e));

// Tell the owner the moment a lead does something worth a call. Never blocks the visitor.
async function ping(subject: string, l: Record<string, any>) {
  try {
    const key = Deno.env.get("BREVO_API_KEY"), to = await admins();
    if (!key || !to.length) return;
    const text = [subject, "", `Crew: ${l.crew || ""}`, `Name: ${l.full_name || ""}`, `Email: ${l.email}`, `Phone: ${l.phone || ""}`, "", "All demo leads: " + SITE + "/people.html"].join("\n");
    await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender: { name: "Subduction leads", email: Deno.env.get("FROM_EMAIL") || CONTACT }, replyTo: { email: l.email }, to: to.map((email) => ({ email })),
        subject, textContent: text, htmlContent: "<pre style=\"font:15px/1.6 Arial,sans-serif\">" + esc(text) + "</pre>", tags: ["lead"] }) });
  } catch (e) { console.error("demo: ping failed", (e as Error).message); }
}
// A one-tap sign-in button by email, for someone who is on a crew (or is staff). Built like the ticket email so it
// lands in the main inbox: plain sender, no bulk-mail headers. The link is single-use and short-lived, and the
// secret is stored only as a hash (same scheme the promoter app checks).
// Anyone on an artist pass, including a revoked one. null means the lookup failed, so send nothing.
async function artistContact(email: string): Promise<boolean | null> {
  const same = (e: string | null) => String(e || "").trim().toLowerCase() === email;
  const [a, m] = await Promise.all([
    db.from("artist_invites").select("email").ilike("email", email).limit(8),
    db.from("artist_members").select("email").ilike("email", email).limit(8),
  ]);
  if (a.error || m.error) return null;
  return (a.data || []).some((r) => same(r.email)) || (m.data || []).some((r) => same(r.email));
}
async function sendSigninLink(email: string): Promise<boolean> {
  const { data: m } = await db.from("subscribers").select("id,status,first_name").eq("email", email).maybeSingle();
  if (!m || m.status === "deleted") return false;
  const { count } = await db.from("company_staff").select("id", { count: "exact", head: true }).eq("subscriber_id", m.id);
  if (!(count ?? 0) && !(await admins()).includes(email)) return false;
  // Artist pass mail is the only mail an artist contact gets, and it is sent elsewhere.
  if (await artistContact(email) !== false) return false;
  // One a minute per person, so nobody can flood an inbox by typing someone else's address.
  const { data: recent } = await db.from("signin_codes").select("id").eq("subscriber_id", m.id).gte("created_at", new Date(Date.now() - 60000).toISOString()).limit(1);
  if (recent?.length) return true;
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) { console.error("demo: BREVO_API_KEY not set"); return false; }
  // At most 10 sign-in emails a day per address, and a new one cancels every older live code.
  const { count: sentToday } = await db.from("engagement_events").select("id", { count: "exact", head: true }).eq("subscriber_id", m.id).eq("type", "signin:sent").gte("created_at", new Date(Date.now() - 86400000).toISOString());
  if ((sentToday ?? 0) >= 10) return true;
  await db.from("engagement_events").insert({ subscriber_id: m.id, type: "signin:sent" });
  await db.from("signin_codes").update({ used_at: new Date().toISOString() }).eq("subscriber_id", m.id).is("used_at", null);
  const secret = hex(18);
  const hash = await sha256(`${m.id}|${secret}|${await setting("ip_salt", "unset")}`);
  const { data: row } = await db.from("signin_codes").insert({ subscriber_id: m.id, code_hash: hash, expires_at: new Date(Date.now() + 20 * 60000).toISOString() }).select("id").single();
  if (!row) return false;
  const url = `${SITE}/promoter.html#invite=${row.id}.${secret}`, F = "font-family:Arial,Helvetica,sans-serif";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Sign in to Subduction</title></head>
<body style="margin:0;background:#0a0a0a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111110;border:1px solid #2b2927">
<tr><td style="padding:28px 24px 0;${F};font-size:26px;line-height:1.15;font-weight:bold;color:#f4f1ee">Tap to sign in</td></tr>
<tr><td style="padding:12px 24px 0;${F};font-size:15px;line-height:1.6;color:#d9d5cf">This button signs you in to your promoter account on this device. No code, no password.</td></tr>
<tr><td style="padding:22px 24px 0"><a href="${url}" style="display:block;background:#b6ff00;color:#000;${F};font-size:16px;font-weight:bold;text-align:center;text-decoration:none;padding:16px 12px;text-transform:uppercase;letter-spacing:1px">Sign me in</a></td></tr>
<tr><td style="padding:18px 24px 26px;${F};font-size:12px;line-height:1.6;color:#6f6b66">Works once, for 20 minutes. Didn't ask for this? Ignore it and nothing changes.</td></tr>
</table></td></tr></table></body></html>`;
  const text = ["Tap to sign in to your Subduction promoter account:", url, "", "Works once, for 20 minutes. Didn't ask for this? Ignore it and nothing changes."].join("\n");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: "Subduction", email: Deno.env.get("FROM_EMAIL") || CONTACT }, to: [{ email }], subject: "Your Subduction sign-in button", htmlContent: html, textContent: text, tags: ["signin"] }) });
  if (!r.ok) { console.error("demo: sign-in email failed", r.status, (await r.text().catch(() => "")).slice(0, 200)); return false; }
  return true;
}
const pub = (l: Record<string, any>) => ({ token: l.token, code: l.code, name: l.full_name, crew: l.crew, email: l.email, phone: l.phone, scanned_at: l.scanned_at });

// Built to match the real ticket email that lands in the main inbox: same kind of sender name and subject,
// no bulk-mail headers. A one-off the person asked for, like a ticket. Dylan approved this on Nov 23, 2026.
async function sendTicket(l: Record<string, any>) {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) { console.error("demo: BREVO_API_KEY not set"); return false; }
  const first = (l.full_name || "").trim().split(/\s+/)[0] || "there", by = l.crew || "Your crew";
  // The link in the email carries a one-tap key: opening it proves this inbox is theirs.
  const k = hex(24);
  await db.from("demo_leads").update({ claim_hash: await sha256(k) }).eq("id", l.id);
  const F = "font-family:Arial,Helvetica,sans-serif", url = ticketUrl(l.token) + "&k=" + k;
  const subject = "Your tickets: Demo Night";
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
<tr><td style="padding:22px 24px 26px;${F};font-size:12px;line-height:1.6;color:#6f6b66">You asked for this test ticket at subduction.art/demo. Don't want to hear from us again? Just reply and say so.<br>Subduction · ${esc(await setting("mailing_address", "PO Box TBD, Bloomington, IL 61701"))}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Test ticket (not a real show): Demo Night, ${by}`, "", `Hi ${first}, you're in. This is the email your buyers get the second they pay, with your crew's name on it.`, "",
    `General Admission · ${l.full_name || ""}`, `Code ${l.code}`, "", "Open the ticket and scan it:", url, "",
    `You asked for this test ticket at subduction.art/demo. Don't want to hear from us again? Just reply and say so.`, "Subduction"].join("\n");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: `${by} Tickets`.slice(0, 70), email: Deno.env.get("FROM_EMAIL") || CONTACT },
      to: [{ email: l.email, name: l.full_name || undefined }], subject, htmlContent: html, textContent: text, tags: ["tickets"] }) });
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
    if (!l.scanned_at) { await db.from("demo_leads").update({ scanned_at: at }).eq("id", l.id); await ping(`Demo finished: ${l.crew || l.full_name || l.email}`, l); }
    return json({ ...pub(l), scanned_at: at, again: !!l.scanned_at });
  }

  if (b.a === "claim") {
    const tok = clean(b.t, 40), k = clean(b.k, 60);
    if (!TOKEN.test(tok)) return no("Not found", 404);
    const { data: l } = await db.from("demo_leads").select("*").eq("token", tok).maybeSingle();
    if (!l) return no("Not found", 404);
    const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await sha256("claim|" + l.id) });
    if ((n ?? 0) > 10) return no("Too many tries. Wait a minute and try again.", 429);
    // The key from the email link is the proof the inbox is theirs. Without it nothing is created and nobody is
    // added to a crew: a stranger holding a ticket link can't open someone else's account.
    const proven = !!k && !!l.claim_hash && (await sha256(k)) === l.claim_hash && !(await admins()).includes(String(l.email).toLowerCase());
    if (!proven) { await sendSigninLink(String(l.email).toLowerCase()); return json({ link_sent: true, email: l.email }); }
    // Their member record and their crew, made once.
    let { data: m } = await db.from("subscribers").select("id,status").eq("email", l.email).maybeSingle();
    if (!m) m = (await db.from("subscribers").insert({ email: l.email, source: "promoter" }).select("id,status").single()).data;
    if (!m || m.status === "deleted") return no("Couldn't open your account. Email " + CONTACT + " and we'll set it up.", 500);
    let companyId = l.company_id as string | null;
    if (!companyId) {
      const base = (l.crew || "crew").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "crew";
      const taken = (await db.from("companies").select("id").eq("slug", base).maybeSingle()).data;
      const { data: co, error } = await db.from("companies").insert({ slug: taken ? `${base}-${hex(2)}` : base, name: l.crew || "My crew", status: "active", contact_email: l.email }).select("id").single();
      if (error || !co) { console.error("demo: company failed", error?.message); return no("Couldn't open your account. Try again.", 500); }
      companyId = co.id;
      await db.from("demo_leads").update({ company_id: companyId, claimed_at: new Date().toISOString() }).eq("id", l.id);
      await ping(`New promoter account: ${l.crew || l.full_name || l.email}`, l);
    }
    await db.from("company_staff").upsert({ company_id: companyId, subscriber_id: m.id, role: "owner" }, { onConflict: "company_id,subscriber_id", ignoreDuplicates: true });
    // Referral credit is a ledger row. A missing migration must not block the new account.
    const linked = await db.rpc("attach_promoter_referral", { p_company: companyId, p_email: String(l.email || ""), p_code: l.referral_code || null });
    if (linked.error) console.error("demo: referral", linked.error.message);
    const session = hex(32);
    await db.from("admin_sessions").insert({ subscriber_id: m.id, token_hash: await sha256(session), expires_at: new Date(Date.now() + 30 * 86400000).toISOString() });
    return json({ session });
  }

  if (b.a === "signin") {
    const email = clean(b.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) return no("That email doesn't look right.");
    const ipRaw = clientIp(req);
    const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await sha256(ipRaw + "|" + (await setting("ip_salt", "unset")) + "|signin") });
    if ((n ?? 0) > 6) return no("Too many tries. Wait a minute and try again.", 429);
    await sendSigninLink(email);
    return json({ sent: true });   // same answer either way, so this can't be used to find out who's a promoter
  }

  if (b.a !== "start") return no("Bad request");
  if (clean(b.website, 200)) return json({ ok: true });   // honeypot: bots fill it, people never see it
  const ipRaw = clientIp(req);
  const ip = await sha256(ipRaw + "|" + (await setting("ip_salt", "unset")) + "|demo");   // hashed, never stored raw
  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: ip });
  if ((n ?? 0) > 8) return no("Too many tries. Wait a minute and try again.", 429);

  const email = clean(b.email, 254).toLowerCase(), name = clean(b.name, 80), crew = clean(b.crew, 80);
  const pref = clean(String(b.referral_code || ""), 16).toLowerCase();
  const referral_code = /^[a-z0-9]{8}$/.test(pref) ? pref : null;
  if (!name || name.split(/\s+/).length < 2) return no("Enter your full name (first and last).");
  if (!crew) return no("Enter your crew or promoter name.");
  if (!EMAIL_RE.test(email)) return no("Enter the email your test ticket should go to.");
  const digits = String(b.phone ?? "").replace(/\D/g, "");
  const phone = digits.length === 10 ? "+1" + digits : digits.length === 11 && digits[0] === "1" ? "+" + digits : digits.length >= 11 && digits.length <= 15 ? "+" + digits : "";
  if (!phone) return no("Enter a phone number we can reach you at.");

  let { data: l } = await db.from("demo_leads").select("*").eq("email", email).maybeSingle();
  // An address already on file is left exactly as it is: no name, crew, phone or referral change, no new email,
  // and no token in the answer. Anyone can type anyone's address here, so the answer must be the same for everyone.
  if (l) return json({ sent: true });
  {
    let ins = await db.from("demo_leads").insert({ email, full_name: name, crew, phone, token: hex(16), code: newCode(), ip_hash: ip, referral_code }).select("*").single();
    if (ins.error && /referral_code/.test(ins.error.message || "")) {
      ins = await db.from("demo_leads").insert({ email, full_name: name, crew, phone, token: hex(16), code: newCode(), ip_hash: ip }).select("*").single();
    }
    if (ins.error || !ins.data) { console.error("demo: insert failed", ins.error?.message); return no("Couldn't set that up. Try again.", 500); }
    l = ins.data;
  }
  // One email per ten minutes per address, so the form can't be used to spam someone.
  const recent = l.emailed_at && Date.now() - new Date(l.emailed_at).getTime() < 10 * 60_000;
  const sent = recent ? true : await sendTicket(l);
  return json({ ...pub(l), sent });
});
