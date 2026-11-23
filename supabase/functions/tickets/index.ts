import QRCode from "npm:qrcode@1.5.4";
import { db, setting } from "../_shared/db.ts";
import { json, err, preflight, EMAIL_RE, clean, ipHash } from "../_shared/util.ts";
import { SITE_URL } from "../_shared/config.ts";
import { loadEvent, availability, stripe, TICKET_PAGE } from "../_shared/tickets.ts";
import { ticketsPdf, sendLocation, revealLabel } from "../_shared/send.ts";
import { loadCompany, feeFor, connectTotals, allInPrice, staffAuth, canSee } from "../_shared/company.ts";
import { cleanPage } from "../_shared/page_spec.ts";

// Art in show pages may only come from our own storage (plus the site's assets/ folder).
const STORAGE_HOSTS = (() => { try { return [new URL(Deno.env.get("SUPABASE_URL") || "").host]; } catch { return []; } })();

// Card fee for an amount so the show still nets the full amount after Stripe's 2.9% + 30c.
// tickets.js uses the same formula to show all-in prices.
const cardFee = (cents: number) => (cents > 0 ? Math.ceil((cents + 30) / (1 - 0.029)) - cents : 0);

// The public side of ticketing.
//   GET  ?e=slug              the event, its nights and what's on sale right now
//   POST {a:"checkout", ...}  hold the tickets, open a Stripe checkout, return its client secret
//   GET  ?a=order&s=cs_...    after paying: has the order gone through, and the ticket links
//   GET  ?a=ticket&t=token    one ticket, for the ticket page
//   GET  ?a=qr&t=token        that ticket's QR code as a PNG (for the email)
const SLUG = /^[a-z0-9-]{1,80}$/, TOKEN = /^[0-9a-f]{48}$/;

Deno.serve(async (req) => {
  // Browsers ask first before sending the staff sign-in header (used by preview / Stripe sign-up).
  if (req.method === "OPTIONS") { const r = preflight(req)!; return new Response(null, { status: 204, headers: { ...Object.fromEntries(r.headers), "Access-Control-Allow-Headers": "content-type, x-admin-token" } }); }
  const u = new URL(req.url), a = u.searchParams.get("a") || "";

  if (req.method === "GET" && a === "qr") {
    const t = u.searchParams.get("t") || "";
    if (!TOKEN.test(t)) return err("Not found", 404);
    const { data: tk } = await db.from("tickets").select("token").eq("token", t).maybeSingle();
    if (!tk) return err("Not found", 404);
    const png = await QRCode.toBuffer(TICKET_PAGE(t), { type: "png", width: 440, margin: 2, errorCorrectionLevel: "M" });
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" } });
  }

  // One ticket as a PDF, for the "Download PDF" button on the ticket page.
  if (req.method === "GET" && a === "pdf") {
    const t = u.searchParams.get("t") || "";
    if (!TOKEN.test(t)) return err("Not found", 404);
    const { data: tk } = await db.from("tickets").select("order_id,code,status").eq("token", t).maybeSingle();
    if (!tk || tk.status !== "valid") return err("Not found", 404);
    const pdf = await ticketsPdf(tk.order_id, t);
    if (!pdf) return err("Not found", 404);
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="TOFTU-ticket-${tk.code}.pdf"`,
      "Cache-Control": "private, no-store", "Access-Control-Allow-Origin": "*" } });
  }

  if (req.method === "GET" && a === "ticket") {
    const t = u.searchParams.get("t") || "";
    if (!TOKEN.test(t)) return err("Not found", 404);
    const { data: tk } = await db.from("tickets").select("id,code,token,holder_name,tier,status,is_comp,event_id,type_id").eq("token", t).maybeSingle();
    if (!tk) return err("Not found", 404);
    const [{ data: ev }, { data: ty }, { data: scans }] = await Promise.all([
      db.from("events").select("slug,name,venue,address,age,location_secret,address_reveal_at").eq("id", tk.event_id).single(),
      db.from("ticket_types").select("slug,name,night_ids").eq("id", tk.type_id).single(),
      db.from("ticket_scans").select("night_id,scanned_at").eq("ticket_id", tk.id),
    ]);
    const { data: nights } = await db.from("ticket_nights").select("id,label,starts_at,ends_at").in("id", ty?.night_ids || []).order("sort");
    return json({
      ticket: { code: tk.code, token: tk.token, name: tk.holder_name, type: ty?.name, tier: tk.tier, status: tk.status, comp: tk.is_comp, artist: ty?.slug === "artist" },
      event: ev ? { slug: ev.slug, name: ev.name, venue: ev.venue, address: ev.address, age: ev.age,
        reveal: !ev.address && ev.location_secret ? revealLabel(ev.address_reveal_at) : null } : null,
      nights: (nights || []).map((n) => ({ label: n.label, starts_at: n.starts_at, ends_at: n.ends_at, used_at: scans?.find((s) => s.night_id === n.id)?.scanned_at || null })),
    }, 200, { "Cache-Control": "no-store" });
  }

  // Reveal day (called by the database's scheduled job): email the address to every ticket holder, once.
  if (req.method === "POST" && a === "reveal") {
    const key = req.headers.get("x-reveal-key") || "";
    if (!key || key !== (await setting("reveal_key", ""))) return err("Not found", 404);
    const slug = u.searchParams.get("e") || "";
    const { data: ev } = await db.from("events").select("id,address").eq("slug", slug).maybeSingle();
    if (!ev?.address) return err("Address isn't revealed yet", 409);
    const { data: orders } = await db.from("ticket_orders").select("id").eq("event_id", ev.id).in("status", ["paid", "comp"]).is("location_sent_at", null).limit(2000);
    let sent = 0, failed = 0;
    for (const o of orders || []) { (await sendLocation(o.id)) ? sent++ : failed++; }
    console.log("reveal", slug, { sent, failed });
    return json({ sent, failed });
  }

  if (req.method === "GET" && a === "order") {
    const s = u.searchParams.get("s") || "";
    if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(s)) return err("Not found", 404);
    const { data: o } = await db.from("ticket_orders").select("id,status,email,total_cents").eq("stripe_session_id", s).maybeSingle();
    if (!o) return err("Not found", 404);
    const { data: tix } = o.status === "paid"
      ? await db.from("tickets").select("code,token,type_id").eq("order_id", o.id).eq("status", "valid").order("created_at")
      : { data: [] };
    const { data: types } = await db.from("ticket_types").select("id,name").in("id", [...new Set((tix || []).map((t) => t.type_id))]);
    return json({
      status: o.status, email: o.email, total_cents: o.total_cents,
      tickets: (tix || []).map((t) => ({ code: t.code, token: t.token, type: types?.find((x) => x.id === t.type_id)?.name })),
    }, 200, { "Cache-Control": "no-store" });
  }

  if (req.method === "GET") {
    const slug = u.searchParams.get("e") || "";
    if (!SLUG.test(slug)) return err("Not found", 404);
    const x = await loadEvent(slug);
    if (!x) return err("Not found", 404);
    const { ev, nights, types } = x;
    // The show's page description and who runs it. Looked up on their own so a database without
    // these columns yet still serves the original tickets page exactly as before.
    const { data: extra } = await db.from("events").select("company_id,page,page_draft").eq("id", ev.id).maybeSingle();
    // ?preview=1 from signed-in staff of that company (or Dylan) shows the working draft instead.
    let raw = extra?.page ?? null, preview = false;
    if (u.searchParams.get("preview") === "1") {
      const st = await staffAuth(req);
      if (st && canSee(st, extra?.company_id)) { raw = extra?.page_draft ?? extra?.page ?? null; preview = true; }
    }
    // Subduction's per-ticket fee for this show, so the page can show the true all-in price.
    const co = extra?.company_id ? await loadCompany(extra.company_id) : null;
    const platform = co && !co.legacy_stripe ? (await feeFor(co)) ?? 0 : 0;
    return json({
      page: raw ? cleanPage(raw, STORAGE_HOSTS) : null, preview,
      fee: { platform_cents: platform, card_pct: 0.029, card_fixed_cents: 30 },
      // A secret location stays off the public page; ticket holders get it on their ticket and in the email.
      event: { slug: ev.slug, name: ev.name, venue: ev.location_secret ? "Secret location" : ev.venue, city: ev.city,
               address: ev.location_secret ? null : ev.address, location_secret: ev.location_secret, description: ev.description, age: ev.age,
               poster_url: ev.poster_url, sales_open: ev.sales_open, max_per_order: ev.max_per_order },
      nights: nights.map((n) => ({ id: n.id, slug: n.slug, label: n.label, starts_at: n.starts_at, ends_at: n.ends_at, lineup: n.lineup, flyer_url: n.lineup?.length ? n.flyer_url || null : null })),
      types: await availability(types.filter((t) => t.on_sale)),
      stripe_key: Deno.env.get("STRIPE_PUBLISHABLE_KEY") || null,
    }, 200, { "Cache-Control": "no-store" });
  }

  if (req.method !== "POST") return err("Not allowed", 405);
  let b: Record<string, unknown>; try { b = await req.json(); } catch { return err("Bad request"); }
  if (b.a !== "checkout") return err("Bad request");

  const ip = await ipHash(req, (await setting("ip_salt", "unset")) + "|tickets");
  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: ip });
  if ((n ?? 0) > 20) return err("Too many tries. Wait a minute and try again.", 429);

  const slug = clean(b.e, 80) || "", email = (clean(b.email, 254) || "").toLowerCase(), name = clean(b.name, 80);
  if (!SLUG.test(slug)) return err("Bad request");
  if (!EMAIL_RE.test(email)) return err("Enter the email your tickets should go to.");
  if (!name || name.trim().split(/\s+/).length < 2) return err("Enter your full name (first and last).");
  // Phone for the order: digits only, US numbers get +1, anything else must already carry its country code.
  const digits = String(b.phone ?? "").replace(/\D/g, "");
  const phone = digits.length === 10 ? "+1" + digits : digits.length === 11 && digits[0] === "1" ? "+" + digits : digits.length >= 11 && digits.length <= 15 ? "+" + digits : "";
  if (!phone) return err("Enter a phone number we can reach you at.");
  const x = await loadEvent(slug);
  if (!x) return err("Not found", 404);
  const { ev, types } = x;
  if (!ev.sales_open) return err("Ticket sales aren't open yet.");

  // Which company runs this show, and whether it sells through its own Stripe (Connect) or the
  // platform's account (legacy: T.O.F.T.U. and earlier shows). Any doubt = legacy, which is today's behaviour.
  const { data: evCo, error: evCoErr } = await db.from("events").select("company_id,review_status").eq("id", ev.id).maybeSingle();
  const co = !evCoErr && evCo?.company_id ? await loadCompany(evCo.company_id) : null;
  const connect = !!co && !co.legacy_stripe;
  let feePer = 0;
  if (connect) {
    if (co!.status !== "active" || evCo!.review_status !== "approved") return err("Ticket sales aren't open yet.");
    if (!co!.stripe_account_id || !co!.stripe_charges_enabled) return err("This show can't take payments yet. Try again soon.");
    const f = await feeFor(co!);
    if (f === null) { console.error("checkout: platform_fee_cents not set", co!.slug); return err("Ticket sales aren't open yet."); }
    feePer = f;
  }
  const acct = connect ? co!.stripe_account_id! : undefined;

  const want = (Array.isArray(b.items) ? b.items : []).slice(0, 10).map((i: Record<string, unknown>) => {
    const t = types.find((t) => t.slug === i.slug);
    const qty = Math.floor(Number(i.qty) || 0);
    return t && qty > 0 ? { type_id: t.id, qty: Math.min(qty, 20) } : null;
  }).filter(Boolean);
  if (!want.length) return err("Pick at least one ticket.");

  // One connection can have at most two checkouts open at once, so nobody can tie up the room.
  const { count: open } = await db.from("ticket_orders").select("id", { count: "exact", head: true })
    .eq("ip_hash", ip).eq("status", "pending").gt("hold_until", new Date().toISOString());
  if ((open ?? 0) >= 2) return err("You already have a checkout open. Finish it, or wait a few minutes and try again.", 429);

  // Hold the tickets for 35 minutes (Stripe's checkout lasts 31), priced tier by tier.
  const { data: orderId, error: holdErr } = await db.rpc("ticket_hold", {
    p_event: ev.id, p_want: want, p_email: email, p_name: name,
    p_promo: clean(b.promo, 40), p_ref: clean(b.ref, 80), p_minutes: 35,
  });
  if (holdErr || !orderId) return err(holdErr?.message || "Couldn't hold those tickets. Try again.");
  const { data: o } = await db.from("ticket_orders").select("id,items,subtotal_cents,discount_cents").eq("id", orderId).single();
  // The buyer covers the card fee (Stripe: 2.9% + 30c), and the ticket page shows each ticket's
  // all-in price up front (FTC fee rule). So the fee is worked out per ticket, the same way the
  // page does it, and a buyer never pays more than the all-in prices they saw. With a promo code
  // the fee is figured on the discounted order instead, which only ever comes out lower.
  const net = o!.subtotal_cents - o!.discount_cents;
  const items = o!.items as { unit_cents: number; qty: number }[];
  const paidTickets = items.reduce((n, it) => n + it.qty, 0);
  //   Legacy (T.O.F.T.U.): card fee only, on the platform's own Stripe.
  //   Connect (promoters): card fee plus Subduction's per-ticket fee, routed to the platform by Stripe.
  let fee: number, platformFee = 0;
  if (connect) {
    const perTicket = items.reduce((s, it) => s + it.qty * (allInPrice(it.unit_cents, feePer) - it.unit_cents), 0);
    const whole = connectTotals(net, paidTickets, feePer);
    fee = net <= 0 ? 0 : o!.discount_cents > 0 ? Math.min(whole.card + whole.platform, perTicket) : perTicket;
    platformFee = net <= 0 ? 0 : feePer * paidTickets;
  } else {
    const perTicket = items.reduce((s, it) => s + it.qty * cardFee(it.unit_cents), 0);
    fee = net <= 0 ? 0 : o!.discount_cents > 0 ? Math.min(cardFee(net), perTicket) : perTicket;
  }
  const ct = connect ? { platform: platformFee } : null;
  await db.from("ticket_orders").update({ fee_cents: fee, total_cents: net + fee, ip_hash: ip, phone,
    ...(ct ? { platform_fee_cents: ct.platform, stripe_account_id: acct } : {}) }).eq("id", o!.id);

  try {
    const line_items: Record<string, unknown> = {};
    (o!.items as { name: string; tier: string; unit_cents: number; qty: number }[]).forEach((it, i) => {
      line_items[i] = {
        quantity: it.qty,
        price_data: { currency: "usd", unit_amount: it.unit_cents, product_data: { name: `${ev.name}: ${it.name}`, description: it.tier } },
      };
    });
    if (fee > 0 && ct) {
      // One clearly described fee line (the FTC rule frowns on vague "processing fee" labels).
      line_items[Object.keys(line_items).length] = { quantity: 1, price_data: { currency: "usd", unit_amount: fee,
        product_data: { name: "Ticketing fee", description: `Subduction platform fee (${paidTickets} ticket${paidTickets === 1 ? "" : "s"}) plus card processing by Stripe` } } };
    } else if (fee > 0) {
      line_items[Object.keys(line_items).length] = { quantity: 1, price_data: { currency: "usd", unit_amount: fee, product_data: { name: "Card processing fee" } } };
    }
    let discounts: Record<string, unknown> | undefined;
    if (o!.discount_cents > 0) {
      const c = await stripe("coupons", { amount_off: o!.discount_cents, currency: "usd", duration: "once", max_redemptions: 1, name: "Promo code" }, "POST", acct);
      discounts = { 0: { coupon: c.id } };
    }
    const session = await stripe("checkout/sessions", {
      ui_mode: "embedded", mode: "payment",
      // Back to the page they bought on: the new show page, or the original tickets page.
      return_url: `${SITE_URL}/${b.page === "show" ? "show" : "tickets"}.html?e=${ev.slug}&s={CHECKOUT_SESSION_ID}`,
      customer_email: email, line_items, discounts,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      client_reference_id: o!.id,
      metadata: { order_id: o!.id, event: ev.slug },
      payment_intent_data: { metadata: { order_id: o!.id, event: ev.slug }, description: `${ev.name} tickets`,
        application_fee_amount: ct && ct.platform > 0 ? ct.platform : undefined },
    }, "POST", acct);
    await db.from("ticket_orders").update({ stripe_session_id: session.id }).eq("id", o!.id);
    return json({ client_secret: session.client_secret, session_id: session.id });
  } catch (e) {
    await db.from("ticket_orders").update({ status: "expired", hold_until: null }).eq("id", o!.id);
    return err((e as Error).message || "Payment setup failed. Try again.", 502);
  }
});
