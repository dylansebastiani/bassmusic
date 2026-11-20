// Ticketing helpers shared by the tickets, stripe-webhook and door functions.
// Prices and tiers come from the database (ticket_types.tiers), never from this repo.
import { db, setting } from "./db.ts";
import { sha256 } from "./util.ts";
import { SITE_URL, CONFIG } from "./config.ts";
import { brevo as provider } from "./email/brevo.ts";   // <- swap provider here
import { requireAdmin } from "./admin.ts";

export const FN_URL = (Deno.env.get("SUPABASE_URL") || "https://hxfuelulxsituzcgsvhg.supabase.co") + "/functions/v1";
export const TICKET_PAGE = (token: string) => `${SITE_URL}/ticket.html?t=${token}`;
export const QR_URL = (token: string) => `${FN_URL}/tickets?a=qr&t=${token}`;
export const usd = (c: number) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);

export interface Tier { name: string; price_cents: number; qty: number }
export interface TicketType { id: string; slug: string; name: string; blurb: string | null; night_ids: string[]; tiers: Tier[]; door_price_cents: number | null; on_sale: boolean; sort: number }
export interface Night { id: string; slug: string; label: string; starts_at: string | null; ends_at: string | null; lineup: { name: string; note?: string }[]; sort: number }

export async function loadEvent(slug: string) {
  const { data: ev } = await db.from("events")
    .select("id,slug,name,venue,city,address,description,age,poster_url,sales_open,max_per_order,starts_at,ends_at,door_pin_hash,location_secret")
    .eq("slug", slug).maybeSingle();
  if (!ev) return null;
  const [{ data: nights }, { data: types }] = await Promise.all([
    db.from("ticket_nights").select("id,slug,label,starts_at,ends_at,lineup,sort").eq("event_id", ev.id).order("sort"),
    db.from("ticket_types").select("id,slug,name,blurb,night_ids,tiers,door_price_cents,on_sale,sort").eq("event_id", ev.id).order("sort"),
  ]);
  return { ev, nights: (nights || []) as Night[], types: (types || []) as TicketType[] };
}

// Where each ticket type stands right now: the current tier, how many are left at that
// price, and how many are left in total. Holds from people mid-checkout count as taken.
export async function availability(types: TicketType[]) {
  return await Promise.all(types.map(async (t) => {
    const { data: taken } = await db.rpc("ticket_type_taken", { p_type: t.id });
    const n = (taken as number) || 0;
    const total = t.tiers.reduce((s, x) => s + x.qty, 0);
    let start = 0, current: (Tier & { left: number }) | null = null, next: Tier | null = null;
    for (let i = 0; i < t.tiers.length; i++) {
      const end = start + t.tiers[i].qty;
      if (!current && n < end) { current = { ...t.tiers[i], left: end - n }; next = t.tiers[i + 1] || null; }
      start = end;
    }
    return {
      slug: t.slug, name: t.name, blurb: t.blurb, night_ids: t.night_ids, on_sale: t.on_sale,
      sold_out: !current, left: Math.max(0, total - n),
      tier: current ? { name: current.name, price_cents: current.price_cents, left: current.left } : null,
      next_tier: next ? { name: next.name, price_cents: next.price_cents } : null,
      tier_count: t.tiers.length,
    };
  }));
}

// ---------- Stripe (plain REST, no SDK) ----------
function form(obj: Record<string, unknown>, prefix = "", out: string[] = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}
export async function stripe(path: string, params?: Record<string, unknown>, method = "POST") {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Stripe isn't connected yet.");
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method, headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20" },
    body: method === "GET" ? undefined : form(params || {}),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json();
  if (!r.ok) { console.error("stripe", path, r.status, JSON.stringify(j.error || j).slice(0, 400)); throw new Error(j.error?.message || "Payment setup failed."); }
  return j;
}
// Stripe-Signature: t=..., v1=... ; signed payload is `${t}.${raw body}`. 5-minute tolerance.
export async function verifyStripe(raw: string, header: string | null) {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)).filter((p) => p.length === 2)) as Record<string, string>;
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !sigs.length) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${raw}`)));
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && timingSafeEq(s, hex));
}
function timingSafeEq(a: string, b: string) { let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// ---------- the ticket email ----------
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function sendTickets(orderId: string) {
  const { data: o } = await db.from("ticket_orders").select("id,event_id,email,name,status,total_cents,emailed_at,comp_list").eq("id", orderId).maybeSingle();
  if (!o || !o.email || o.emailed_at) return false;
  const [{ data: ev }, { data: tix }, { data: types }, { data: nights }] = await Promise.all([
    db.from("events").select("name,venue,address,age").eq("id", o.event_id).single(),
    db.from("tickets").select("code,token,type_id,tier,holder_name").eq("order_id", o.id).eq("status", "valid").order("created_at"),
    db.from("ticket_types").select("id,name,night_ids").eq("event_id", o.event_id),
    db.from("ticket_nights").select("id,label,starts_at").eq("event_id", o.event_id).order("sort"),
  ]);
  if (!ev || !tix?.length) return false;
  const tname = (id: string) => types?.find((t) => t.id === id)?.name || "Ticket";
  const nightsFor = (id: string) => (types?.find((t) => t.id === id)?.night_ids || []).map((n: string) => nights?.find((x) => x.id === n)?.label).filter(Boolean).join(" + ");
  const doors = (nights || []).map((n) => n.starts_at ? `${n.label}: doors ${new Date(n.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}` : "").filter(Boolean).join(" · ");

  const cards = tix.map((t, i) => `
<tr><td style="padding:0 0 22px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #333">
<tr><td style="padding:18px 18px 6px;font:900 20px/1.2 ${FONT};color:#fff;text-transform:uppercase">${esc(tname(t.type_id))}${tix.length > 1 ? ` <span style="color:#777;font-size:13px">${i + 1} of ${tix.length}</span>` : ""}</td></tr>
<tr><td style="padding:0 18px 14px;font:13px/1.5 ${FONT};color:#aaa">${esc(nightsFor(t.type_id))}${t.holder_name ? " · " + esc(t.holder_name) : ""}</td></tr>
<tr><td align="center" bgcolor="#ffffff" style="background:#fff;padding:16px"><a href="${TICKET_PAGE(t.token)}"><img src="${QR_URL(t.token)}" width="220" height="220" alt="Ticket QR code ${t.code}" style="display:block;border:0;width:220px;height:220px"></a></td></tr>
<tr><td align="center" style="padding:12px 18px 16px;font:700 18px/1 'Courier New',monospace;letter-spacing:.2em;color:#fff">${t.code}</td></tr>
</table></td></tr>`).join("");

  const comp = o.status === "comp";
  const subject = comp ? `You're on the list: ${ev.name}` : `Your tickets: ${ev.name}`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background:#000" bgcolor="#000000">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000"><tr><td align="center" style="padding:32px 16px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;color:#e9e9e9;font:16px/1.6 ${FONT}">
<tr><td style="padding-bottom:6px;font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:#888">${comp ? "Guest list" : "Order confirmed"}</td></tr>
<tr><td style="padding-bottom:10px;font:900 30px/1.05 ${FONT};color:#fff;text-transform:uppercase">${esc(ev.name)}</td></tr>
<tr><td style="padding-bottom:24px;font-size:14px;color:#bbb">${esc(ev.venue || "")}${ev.address ? "<br>" + esc(ev.address) : ""}${doors ? "<br>" + esc(doors) : ""}${ev.age ? "<br>" + esc(ev.age) + " · bring ID" : ""}</td></tr>
${cards}
<tr><td style="font-size:14px;color:#bbb;padding-bottom:20px">Show the QR code at the door, on your phone or printed. Each code works once per night, so don't share screenshots. Tap a code to open the ticket page.</td></tr>
${!comp && o.total_cents ? `<tr><td style="font-size:13px;color:#888;padding-bottom:6px">Total paid: ${usd(o.total_cents)}</td></tr>` : ""}
<tr><td style="padding-top:24px;border-top:1px solid #222;font-size:12px;line-height:1.7;color:#777">Questions? Reply to this email or write ${esc(CONFIG.contactEmail)}.<br>${esc(CONFIG.mailingAddress)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${comp ? "You're on the guest list" : "Your tickets"} for ${ev.name}\n${ev.venue || ""} ${ev.address || ""}\n${doors}\n\n` +
    tix.map((t) => `${tname(t.type_id)} (${nightsFor(t.type_id)}) ${t.code}\n${TICKET_PAGE(t.token)}`).join("\n\n") +
    `\n\nShow the QR code at the door. Each code works once per night.\n\n${CONFIG.mailingAddress}`;

  const res = await provider.send({
    to: { email: o.email, name: o.name }, subject, html, text, tags: ["tickets"],
    fromName: Deno.env.get("TICKETS_FROM_NAME") || "Underground Tickets",
  });
  if (res.ok) await db.from("ticket_orders").update({ emailed_at: new Date().toISOString() }).eq("id", o.id);
  else console.error("ticket email failed", o.id, res.error);
  return res.ok;
}

// ---------- door access: an admin session, or a door session from the event's PIN ----------
export async function pinHash(eventId: string, pin: string) {
  return sha256(`door|${eventId}|${pin}|${await setting("ip_salt", "unset")}`);
}
export async function newDoorSession(eventId: string) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
  await db.from("door_sessions").insert({ event_id: eventId, token_hash: await sha256(token), expires_at: new Date(Date.now() + 36 * 3600_000).toISOString() });
  return token;
}
// Who is at the door: { admin } can do everything; { door } can scan and check people in for that event only.
export async function doorAuth(req: Request, eventId: string): Promise<{ by: string; admin: boolean } | null> {
  const admin = await requireAdmin(req);
  if (admin) return { by: admin.email, admin: true };
  const tok = (req.headers.get("x-door-token") || "").trim();
  if (!/^[0-9a-f]{64}$/.test(tok)) return null;
  const { data: s } = await db.from("door_sessions").select("event_id,expires_at").eq("token_hash", await sha256(tok)).maybeSingle();
  if (!s || s.event_id !== eventId || new Date(s.expires_at).getTime() < Date.now()) return null;
  return { by: "door", admin: false };
}
