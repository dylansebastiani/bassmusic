// The second ticket lane: checkout, tickets and ticket emails for every promoter that sells on their own
// Stripe account. The first show stays on the original `tickets` function and is never touched from here:
// this function refuses any show whose company uses the original Stripe account.
// Self-contained on purpose (no shared imports), so deploying it can't change any other function.
//   GET  ?e=slug              the show, its tickets, the per-ticket fee and its published page design
//   POST {a:"checkout",...}   hold tickets + start a Stripe checkout on the promoter's own account
//   GET  ?a=order&s=cs_...    the order after payment (confirms with Stripe, issues tickets, sends the email)
//   GET  ?a=ticket&t=token    one ticket, for the ticket page
//   GET  ?a=qr&t=token        that ticket's QR code
//   POST ?a=hook              Stripe's own confirmation for promoter accounts (backup for a closed tab)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import QRCode from "npm:qrcode@1.5.4";
import { addressHeld } from "./reveal.mjs";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = (Deno.env.get("SITE_URL") || "https://subduction.art").replace(/\/$/, "");
const FN = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/checkout";
const CONTACT = Deno.env.get("CONTACT_EMAIL") || "hello@subduction.art";
const CARD_PCT = 0.029, CARD_FIXED = 30;
const SLUG = /^[a-z0-9-]{1,80}$/, TOKEN = /^[0-9a-f]{48}$/, EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-admin-token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
// The only review status a stranger can see. draft, submitted and rejected stay off the public page.
const PUBLIC_REVIEW = "approved";
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra } });
const no = (m: string, s = 400) => json({ error: m }, s);
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : null) || null;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const usd = (c: number) => "$" + (c / 100).toFixed(2);
async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(":00", "");
const doors = (s: string | null, e: string | null) => (s ? "Doors " + time(s) + (e ? " – " + time(e) : "") : "");

// ---------- Stripe, always on the promoter's own account, through Subduction's platform account and its own keys ----------
// (STRIPE_PLATFORM_*). The first show's checkout uses a different account and key and is never called from here.
function form(obj: Record<string, unknown>, prefix = "", out: string[] = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}
async function stripe(account: string, path: string, params?: Record<string, unknown>, method = "POST") {
  const key = Deno.env.get("STRIPE_PLATFORM_SECRET_KEY");
  if (!key) throw new Error("Payments aren't set up yet.");
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method, headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20", "Stripe-Account": account },
    body: method === "GET" ? undefined : form(params || {}), signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json();
  if (!r.ok) { console.error("stripe", path, r.status, JSON.stringify(j.error || j).slice(0, 400)); throw new Error(j.error?.message || "Payment setup failed."); }
  return j;
}
async function verifyHook(raw: string, header: string | null) {
  const secret = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET");
  if (!secret || !header) return false;
  const t = Number((header.split(",").find((p) => p.startsWith("t=")) || "").slice(2));
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !sigs.length) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${raw}`)));
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => { if (s.length !== hex.length) return false; let d = 0; for (let i = 0; i < s.length; i++) d |= s.charCodeAt(i) ^ hex.charCodeAt(i); return d === 0; });
}

// ---------- the show ----------
interface Tier { name: string; price_cents: number; qty: number }
interface Co { id: string; slug: string; name: string; status: string; contact_email: string | null; stripe_account_id: string | null; stripe_charges_enabled: boolean; legacy_stripe: boolean; platform_fee_cents: number | null }
async function loadShow(slug: string) {
  const { data: ev } = await db.from("events")
    .select("id,slug,name,venue,city,address,description,age,poster_url,sales_open,max_per_order,location_secret,address_reveal_at,company_id,page,page_published_at,review_status,kit")
    .eq("slug", slug).maybeSingle();
  if (!ev || !ev.company_id) return null;
  const { data: co } = await db.from("companies").select("id,slug,name,status,contact_email,stripe_account_id,stripe_charges_enabled,legacy_stripe,platform_fee_cents").eq("id", ev.company_id).maybeSingle();
  // Shows on the original Stripe account belong to the original lane. Never served from here.
  if (!co || co.legacy_stripe) return null;
  const [{ data: nights }, { data: types }] = await Promise.all([
    db.from("ticket_nights").select("id,slug,label,starts_at,ends_at,lineup,flyer_url,sort").eq("event_id", ev.id).order("sort"),
    db.from("ticket_types").select("id,slug,name,blurb,night_ids,tiers,on_sale,sort").eq("event_id", ev.id).order("sort"),
  ]);
  const fee = typeof co.platform_fee_cents === "number" ? co.platform_fee_cents : await setting<number | null>("platform_fee_cents", null);
  const ready = co.status === "active" && !!co.stripe_account_id && co.stripe_charges_enabled && typeof fee === "number" && fee >= 0;
  return { ev, co: co as Co, nights: nights || [], types: types || [], fee: typeof fee === "number" ? fee : 0, ready };
}
// Dylan (anyone on the platform staff list) and the crew that owns this show can open it before it is public.
// Everyone else gets nothing: no name, no art, no prices.
async function mayPreview(req: Request, companyId: string): Promise<boolean> {
  const token = (req.headers.get("x-admin-token") || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const { data: s } = await db.from("admin_sessions").select("subscriber_id,expires_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return false;
  const { data: m } = await db.from("subscribers").select("id,email,status").eq("id", s.subscriber_id).maybeSingle();
  if (!m || m.status === "deleted") return false;
  const admins = await setting<string[]>("admin_emails", []);
  if (admins.map((e) => String(e).toLowerCase()).includes(String(m.email).toLowerCase())) return true;
  const { data: row } = await db.from("company_staff").select("company_id").eq("subscriber_id", m.id).eq("company_id", companyId).maybeSingle();
  return !!row;
}
async function availability(types: { id: string; slug: string; name: string; blurb: string | null; night_ids: string[]; tiers: Tier[]; on_sale: boolean }[]) {
  return await Promise.all(types.map(async (t) => {
    const { data: taken } = await db.rpc("ticket_type_taken", { p_type: t.id });
    const n = (taken as number) || 0, total = t.tiers.reduce((s, x) => s + x.qty, 0);
    let start = 0, current: (Tier & { left: number }) | null = null, next: Tier | null = null;
    for (let i = 0; i < t.tiers.length; i++) {
      const end = start + t.tiers[i].qty;
      if (!current && n < end) { current = { ...t.tiers[i], left: end - n }; next = t.tiers[i + 1] || null; }
      start = end;
    }
    return { slug: t.slug, name: t.name, blurb: t.blurb, night_ids: t.night_ids, on_sale: t.on_sale, sold_out: !current, left: Math.max(0, total - n),
      tier: current ? { name: current.name, price_cents: current.price_cents, left: current.left } : null,
      next_tier: next ? { name: next.name, price_cents: next.price_cents } : null, tier_count: t.tiers.length };
  }));
}
// What the buyer pays so the promoter keeps the full ticket price: Stripe's card fee comes off the total on the
// promoter's account, the flat per-ticket fee goes to Subduction. Rounded up so the promoter is never short.
function totals(net: number, paidTickets: number, feePerTicket: number) {
  if (net <= 0) return { platform: 0, total: 0 };
  const platform = feePerTicket * paidTickets;
  return { platform, total: Math.ceil((net + platform + CARD_FIXED) / (1 - CARD_PCT)) };
}

// ---------- tickets out: issue them and send the email, once ----------
const ticketPage = (token: string) => `${SITE}/pass.html?t=${token}`;
const orderRef = (id: string) => "ORDER-" + id.replace(/-/g, "").slice(0, 6).toUpperCase();
async function finish(orderId: string, paymentIntent: string | null) {
  if (paymentIntent) await db.from("ticket_orders").update({ stripe_payment_intent: paymentIntent }).eq("id", orderId);
  const { error } = await db.rpc("ticket_issue", { p_order: orderId, p_status: "paid" });
  if (error) { console.error("checkout: issue failed", orderId, error.message); return false; }
  await sendTickets(orderId);
  return true;
}
async function sendTickets(orderId: string) {
  // Claim the send first so two confirmations at once can't email twice.
  const { data: o } = await db.from("ticket_orders").update({ emailed_at: new Date().toISOString() }).eq("id", orderId).is("emailed_at", null)
    .select("id,event_id,email,name,subtotal_cents,discount_cents,fee_cents,total_cents,company_id").maybeSingle();
  if (!o || !o.email) return false;
  const [{ data: ev }, { data: tix }, { data: types }, { data: nights }, { data: co }] = await Promise.all([
    db.from("events").select("slug,name,venue,city,address,age,location_secret,address_reveal_at").eq("id", o.event_id).single(),
    db.from("tickets").select("code,token,type_id,holder_name").eq("order_id", o.id).eq("status", "valid").order("created_at"),
    db.from("ticket_types").select("id,name,night_ids").eq("event_id", o.event_id),
    db.from("ticket_nights").select("id,label,starts_at,ends_at").eq("event_id", o.event_id).order("sort"),
    db.from("companies").select("name,contact_email").eq("id", o.company_id).maybeSingle(),
  ]);
  const unclaim = () => db.from("ticket_orders").update({ emailed_at: null }).eq("id", o.id);
  if (!ev || !tix?.length) { await unclaim(); return false; }
  const ns = nights || [], by = co?.name || ev.name, reply = co?.contact_email || CONTACT;
  // A secret-location show prints no venue or address until the reveal time has passed.
  const held = !!ev.location_secret && (!ev.address_reveal_at || Date.parse(ev.address_reveal_at) > Date.now());
  const where = held ? "The address will be emailed to you before the show." : ev.address ? `${ev.venue ? ev.venue + ", " : ""}${ev.address}` : [ev.venue, ev.city].filter(Boolean).join(", ");
  const rows = tix.map((t) => {
    const ty = types?.find((x) => x.id === t.type_id);
    const mine = ns.filter((n) => (ty?.night_ids || []).includes(n.id));
    return { type: ty?.name || "Ticket", when: mine.map((n) => n.label + (n.starts_at ? " · " + doors(n.starts_at, n.ends_at) : "")).join(" + "), holder: t.holder_name, code: t.code, url: ticketPage(t.token), qr: `${FN}?a=qr&t=${t.token}` };
  });
  const first = (o.name || "").trim().split(/\s+/)[0] || "there";
  const subject = `Your ${rows.length > 1 ? "tickets" : "ticket"}: ${ev.name}`;
  const F = "font-family:Arial,Helvetica,sans-serif";
  const money = o.total_cents > 0
    ? `<tr><td style="padding:18px 24px 0;${F};font-size:13px;line-height:1.7;color:#9a958f">Tickets ${usd(o.subtotal_cents)}${o.discount_cents ? ` · Code −${usd(o.discount_cents)}` : ""}${o.fee_cents ? ` · Fees ${usd(o.fee_cents)}` : ""}<br><b style="color:#f4f1ee">Total paid ${usd(o.total_cents)}</b> · ${orderRef(o.id)}</td></tr>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#0a0a0a"><div style="display:none;max-height:0;overflow:hidden;opacity:0">Show the code at the door. One scan per ticket.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111110;border:1px solid #2b2927">
<tr><td style="padding:28px 24px 6px;${F};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#9a958f">${esc(by)}</td></tr>
<tr><td style="padding:0 24px;${F};font-size:28px;line-height:1.15;font-weight:bold;color:#f4f1ee">${esc(ev.name)}</td></tr>
<tr><td style="padding:14px 24px 0;${F};font-size:15px;line-height:1.6;color:#d9d5cf">Hi ${esc(first)}, you're in. ${rows.length > 1 ? "Your tickets are" : "Your ticket is"} below. Show the code at the door.</td></tr>
<tr><td style="padding:10px 24px 0;${F};font-size:14px;line-height:1.6;color:#9a958f">${esc(where)}${ev.age ? " · " + esc(ev.age) + ", bring ID" : ""}</td></tr>
${rows.map((r) => `<tr><td style="padding:20px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #2b2927;background:#0a0a0a"><tr>
<td width="132" style="padding:12px"><a href="${r.url}"><img src="${r.qr}" width="120" height="120" alt="QR code for ticket ${esc(r.code)}" style="display:block;border:0;background:#ffffff"></a></td>
<td style="padding:12px 12px 12px 0;${F};color:#f4f1ee"><div style="font-size:17px;font-weight:bold">${esc(r.type)}</div><div style="font-size:13px;line-height:1.5;color:#9a958f">${esc(r.when)}</div><div style="font-size:13px;line-height:1.5;color:#9a958f">${esc(r.holder || "")}</div>
<div style="font-family:Courier,monospace;font-size:18px;letter-spacing:2px;padding-top:6px">${esc(r.code)}</div><div style="padding-top:8px"><a href="${r.url}" style="${F};font-size:13px;color:#f4f1ee">Open ticket</a></div></td></tr></table></td></tr>`).join("")}
${money}
<tr><td style="padding:22px 24px 26px;${F};font-size:12px;line-height:1.6;color:#6f6b66">Questions about the show? Reply to this email. All sales final unless the show is cancelled.<br>${esc(by)} · ${esc(await setting("mailing_address", "PO Box TBD, Bloomington, IL 61701"))}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`${ev.name} (${by})`, "", `Hi ${first}, you're in. Show the code at the door.`, where + (ev.age ? ` · ${ev.age}, bring ID` : ""), "",
    ...rows.map((r) => `${r.type} · ${r.when}\n${r.holder || ""}\nCode ${r.code}\n${r.url}\n`),
    o.total_cents > 0 ? `Total paid ${usd(o.total_cents)} · ${orderRef(o.id)}` : "", "", "Questions about the show? Reply to this email.", by].join("\n");
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) { console.error("checkout: BREVO_API_KEY not set"); await unclaim(); return false; }
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: `${by} Tickets`.slice(0, 70), email: Deno.env.get("FROM_EMAIL") || "hello@subduction.art" }, replyTo: { email: reply },
      to: [{ email: o.email, name: o.name || undefined }], subject, htmlContent: html, textContent: text, tags: ["tickets"] }) });
  if (!r.ok) { console.error("checkout: ticket email failed", o.id, r.status, (await r.text().catch(() => "")).slice(0, 200)); await unclaim(); return false; }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url), a = u.searchParams.get("a") || "";

  if (req.method === "GET" && a === "qr") {
    const t = u.searchParams.get("t") || "";
    if (!TOKEN.test(t)) return no("Not found", 404);
    const { data: tk } = await db.from("tickets").select("token").eq("token", t).maybeSingle();
    if (!tk) return no("Not found", 404);
    const png = await QRCode.toBuffer(ticketPage(t), { type: "png", width: 440, margin: 2, errorCorrectionLevel: "M" });
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", ...CORS } });
  }

  if (req.method === "GET" && a === "ticket") {
    const t = u.searchParams.get("t") || "";
    if (!TOKEN.test(t)) return no("Not found", 404);
    const { data: tk } = await db.from("tickets").select("id,code,token,holder_name,tier,status,is_comp,event_id,type_id").eq("token", t).maybeSingle();
    if (!tk) return no("Not found", 404);
    const [{ data: ev }, { data: ty }, { data: scans }] = await Promise.all([
      db.from("events").select("slug,name,venue,city,address,age,location_secret,address_reveal_at,company_id").eq("id", tk.event_id).single(),
      db.from("ticket_types").select("slug,name,night_ids").eq("id", tk.type_id).single(),
      db.from("ticket_scans").select("night_id,scanned_at").eq("ticket_id", tk.id),
    ]);
    const { data: co } = ev?.company_id ? await db.from("companies").select("name,legacy_stripe").eq("id", ev.company_id).maybeSingle() : { data: null };
    if (!ev || !co || co.legacy_stripe) return no("Not found", 404);
    const { data: nights } = await db.from("ticket_nights").select("id,label,starts_at,ends_at").in("id", ty?.night_ids || []).order("sort");
    // A secret-location show keeps its address off the ticket until the reveal time has passed.
    const held = addressHeld(ev);
    const address = held ? null : ev.address;
    return json({
      by: co.name,
      ticket: { code: tk.code, token: tk.token, name: tk.holder_name, type: ty?.name, tier: tk.tier, status: tk.status, comp: tk.is_comp, artist: ty?.slug === "artist" },
      event: { slug: ev.slug, name: ev.name, venue: held ? null : ev.venue, city: ev.city, address, age: ev.age, address_later: !address && held },
      nights: (nights || []).map((n) => ({ label: n.label, starts_at: n.starts_at, ends_at: n.ends_at, used_at: scans?.find((s) => s.night_id === n.id)?.scanned_at || null })),
    });
  }

  if (req.method === "GET" && a === "order") {
    const s = u.searchParams.get("s") || "";
    if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(s)) return no("Not found", 404);
    let { data: o } = await db.from("ticket_orders").select("id,status,email,total_cents,stripe_account_id").eq("stripe_session_id", s).maybeSingle();
    if (!o || !o.stripe_account_id) return no("Not found", 404);
    // Still waiting: ask Stripe directly, so tickets arrive even if Stripe's own confirmation is slow.
    if (o.status === "pending") {
      try {
        const sess = await stripe(o.stripe_account_id, "checkout/sessions/" + s, undefined, "GET");
        if (sess.payment_status === "paid" && sess.amount_total === o.total_cents && sess.client_reference_id === o.id) {
          if (await finish(o.id, sess.payment_intent || null)) o = { ...o, status: "paid" };
        }
      } catch (e) { console.error("checkout: confirm failed", o.id, (e as Error).message); }
    }
    const { data: tix } = o.status === "paid" ? await db.from("tickets").select("code,token,type_id").eq("order_id", o.id).eq("status", "valid").order("created_at") : { data: [] };
    const { data: types } = await db.from("ticket_types").select("id,name").in("id", [...new Set((tix || []).map((t) => t.type_id))]);
    return json({ status: o.status, email: o.email, total_cents: o.total_cents, lane: 2,
      tickets: (tix || []).map((t) => ({ code: t.code, token: t.token, type: types?.find((x) => x.id === t.type_id)?.name })) });
  }

  if (req.method === "GET") {
    const slug = u.searchParams.get("e") || "";
    if (!SLUG.test(slug)) return no("Not found", 404);
    const x = await loadShow(slug);
    if (!x) return no("Not found", 404);
    const { ev, co, nights, types, fee, ready } = x;
    // Shows on the original account never reach here (loadShow returns null), so /underground/ is untouched.
    const staffView = ev.review_status !== PUBLIC_REVIEW;
    if (staffView && !(await mayPreview(req, ev.company_id))) return no("Not live yet.", 403);
    return json({
      lane: 2, by: co.name, preview: staffView || undefined,
      event: { slug: ev.slug, name: ev.name, venue: ev.location_secret ? "Secret location" : ev.venue, city: ev.city, address: ev.location_secret ? null : ev.address,
        location_secret: ev.location_secret, description: ev.description, age: ev.age, poster_url: ev.poster_url, sales_open: !!ev.sales_open && ready, max_per_order: ev.max_per_order },
      nights: nights.map((n) => ({ id: n.id, slug: n.slug, label: n.label, starts_at: n.starts_at, ends_at: n.ends_at, lineup: n.lineup, flyer_url: n.lineup?.length ? n.flyer_url || null : null })),
      types: await availability(types.filter((t) => t.on_sale)),
      stripe_key: ready ? Deno.env.get("STRIPE_PLATFORM_PUBLISHABLE_KEY") || null : null, stripe_account: ready ? co.stripe_account_id : null,
      fee: { platform_cents: fee, card_pct: CARD_PCT, card_fixed_cents: CARD_FIXED },
      page: ev.page_published_at ? ev.page ?? null : null,
      // Promoter-supplied Meta pixel. Blank until they save one. This lane never serves T.O.F.T.U.
      pixel: ev.slug === "underground" || ev.id === "63b511f3-d838-404f-9c2e-5d4b98fbf013" ? null : (/^\d{8,20}$/.test(String(ev.kit?.pixel || "")) ? String(ev.kit.pixel) : null),
    });
  }

  if (req.method !== "POST") return no("Not allowed", 405);

  // Stripe's own confirmation for promoter accounts. Off until its signing secret is set.
  if (a === "hook") {
    const raw = await req.text();
    if (!(await verifyHook(raw, req.headers.get("stripe-signature")))) return new Response("bad signature", { status: 400 });
    let ev: { type: string; account?: string; data: { object: Record<string, any> } };
    try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
    const obj = ev.data.object, orderId = obj.metadata?.order_id || obj.client_reference_id;
    if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
      if (obj.payment_status !== "paid") return new Response("waiting", { status: 200 });
      const { data: o } = await db.from("ticket_orders").select("id,status,total_cents,stripe_account_id").eq("id", orderId).maybeSingle();
      if (!o || !o.stripe_account_id || o.stripe_account_id !== ev.account) return new Response("not ours", { status: 200 });
      if (o.status === "refunded") return new Response("refunded", { status: 200 });
      if (obj.amount_total !== o.total_cents) { console.error("checkout hook: amount mismatch", o.id); return new Response("amount mismatch", { status: 200 }); }
      const done = await finish(o.id, obj.payment_intent || null);
      return new Response(done ? "ok" : "retry", { status: done ? 200 : 500 });
    }
    if (ev.type === "checkout.session.expired" && orderId) {
      await db.from("ticket_orders").update({ status: "expired", hold_until: null }).eq("id", orderId).eq("status", "pending").eq("stripe_account_id", ev.account || "");
      return new Response("ok", { status: 200 });
    }
    if (ev.type === "charge.refunded" && obj.refunded && obj.payment_intent) {
      const { data: o } = await db.from("ticket_orders").select("id").eq("stripe_payment_intent", obj.payment_intent).eq("stripe_account_id", ev.account || "").maybeSingle();
      if (o) { await db.from("ticket_orders").update({ status: "refunded" }).eq("id", o.id); await db.from("tickets").update({ status: "void" }).eq("order_id", o.id); }
      return new Response("ok", { status: 200 });
    }
    return new Response("ignored", { status: 200 });
  }

  let b: Record<string, unknown>; try { b = await req.json(); } catch { return no("Bad request"); }
  if (b.a !== "checkout") return no("Bad request");
  const ipRaw = (req.headers.get("cf-connecting-ip") || "").split(",")[0].trim() || "no-ip";
  const ip = await sha256(ipRaw + "|" + (await setting("ip_salt", "unset")) + "|tickets");   // hashed, never stored raw
  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: ip });
  if ((n ?? 0) > 20) return no("Too many tries. Wait a minute and try again.", 429);

  const slug = clean(b.e, 80) || "", email = (clean(b.email, 254) || "").toLowerCase(), name = clean(b.name, 80);
  if (!SLUG.test(slug)) return no("Bad request");
  if (!EMAIL_RE.test(email)) return no("Enter the email your tickets should go to.");
  if (!name || name.trim().split(/\s+/).length < 2) return no("Enter your full name (first and last).");
  const digits = String(b.phone ?? "").replace(/\D/g, "");
  const phone = digits.length === 10 ? "+1" + digits : digits.length === 11 && digits[0] === "1" ? "+" + digits : digits.length >= 11 && digits.length <= 15 ? "+" + digits : "";
  if (!phone) return no("Enter a phone number we can reach you at.");
  const x = await loadShow(slug);
  if (!x) return no("Not found", 404);
  const { ev, co, types, fee, ready } = x;
  if (ev.review_status !== PUBLIC_REVIEW) return no("Not live yet.", 403);
  if (!ev.sales_open || !ready) return no("Ticket sales aren't open yet.");

  const want = (Array.isArray(b.items) ? b.items : []).slice(0, 10).map((i: Record<string, unknown>) => {
    const t = types.find((t) => t.slug === i.slug && t.on_sale);
    const qty = Math.floor(Number(i.qty) || 0);
    return t && qty > 0 ? { type_id: t.id, qty: Math.min(qty, 20) } : null;
  }).filter(Boolean);
  if (!want.length) return no("Pick at least one ticket.");
  const { count: open } = await db.from("ticket_orders").select("id", { count: "exact", head: true }).eq("ip_hash", ip).eq("status", "pending").gt("hold_until", new Date().toISOString());
  if ((open ?? 0) >= 2) return no("You already have a checkout open. Finish it, or wait a few minutes and try again.", 429);

  const { data: orderId, error: holdErr } = await db.rpc("ticket_hold", { p_event: ev.id, p_want: want, p_email: email, p_name: name, p_promo: clean(b.promo, 40), p_ref: clean(b.ref, 80), p_minutes: 35 });
  if (holdErr || !orderId) return no(holdErr?.message || "Couldn't hold those tickets. Try again.");
  const { data: o } = await db.from("ticket_orders").select("id,items,subtotal_cents,discount_cents").eq("id", orderId).single();
  const items = o!.items as { name: string; tier: string; unit_cents: number; qty: number }[];
  const net = o!.subtotal_cents - o!.discount_cents;
  const { platform, total } = totals(net, items.reduce((s, it) => s + (it.unit_cents > 0 ? it.qty : 0), 0), fee);
  await db.from("ticket_orders").update({ fee_cents: Math.max(0, total - net), platform_fee_cents: platform, total_cents: total, ip_hash: ip, phone, company_id: co.id, stripe_account_id: co.stripe_account_id }).eq("id", o!.id);

  // Nothing to pay (free tickets or a full-price code): the tickets go out straight away.
  if (total <= 0) { await finish(o!.id, null); return json({ free: true, order: o!.id }); }
  try {
    const acct = co.stripe_account_id!;
    const line_items: Record<string, unknown> = {};
    items.forEach((it, i) => { line_items[i] = { quantity: it.qty, price_data: { currency: "usd", unit_amount: it.unit_cents, product_data: { name: `${ev.name}: ${it.name}`, description: it.tier || undefined } } }; });
    line_items[items.length] = { quantity: 1, price_data: { currency: "usd", unit_amount: total - net, product_data: { name: "Fees" } } };
    let discounts: Record<string, unknown> | undefined;
    if (o!.discount_cents > 0) {
      const c = await stripe(acct, "coupons", { amount_off: o!.discount_cents, currency: "usd", duration: "once", max_redemptions: 1, name: "Promo code" });
      discounts = { 0: { coupon: c.id } };
    }
    const session = await stripe(acct, "checkout/sessions", {
      ui_mode: "embedded", mode: "payment", return_url: `${SITE}/show.html?e=${ev.slug}&s={CHECKOUT_SESSION_ID}`,
      customer_email: email, line_items, discounts, expires_at: Math.floor(Date.now() / 1000) + 31 * 60, client_reference_id: o!.id,
      metadata: { order_id: o!.id, event: ev.slug },
      // A crew on a $0 fee sends no platform fee at all (Stripe only takes its own card fee).
      payment_intent_data: { ...(platform > 0 ? { application_fee_amount: platform } : {}), metadata: { order_id: o!.id, event: ev.slug }, description: `${ev.name} tickets` },
    });
    await db.from("ticket_orders").update({ stripe_session_id: session.id }).eq("id", o!.id);
    return json({ client_secret: session.client_secret, session_id: session.id, stripe_account: acct });
  } catch (e) {
    await db.from("ticket_orders").update({ status: "expired", hold_until: null }).eq("id", o!.id);
    return no((e as Error).message || "Payment setup failed. Try again.", 502);
  }
});
