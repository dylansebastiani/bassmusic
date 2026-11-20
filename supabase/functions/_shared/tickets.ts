// Ticketing helpers shared by the tickets, stripe-webhook and door functions.
// Prices and tiers come from the database (ticket_types.tiers), never from this repo.
import { db, setting } from "./db.ts";
import { sha256 } from "./util.ts";
import { SITE_URL, CONFIG } from "./config.ts";
import { brevo as provider } from "./email/brevo.ts";   // <- swap provider here
import { requireAdmin } from "./admin.ts";
import { renderTicketEmail } from "./ticket_email.ts";

export const FN_URL = (Deno.env.get("SUPABASE_URL") || "https://hxfuelulxsituzcgsvhg.supabase.co") + "/functions/v1";
export const TICKET_PAGE = (token: string) => `${SITE_URL}/ticket.html?t=${token}`;
export const QR_URL = (token: string) => `${FN_URL}/tickets?a=qr&t=${token}`;

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

// ---------- the ticket email (design lives in ticket_email.ts) ----------
const doorsText = (starts: string | null, ends: string | null) => {
  if (!starts) return null;
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(":00", "");
  return "Doors " + t(starts) + (ends ? " – " + t(ends) : "");
};

export async function sendTickets(orderId: string) {
  const { data: o } = await db.from("ticket_orders").select("id,event_id,email,name,status,subtotal_cents,discount_cents,fee_cents,total_cents,emailed_at").eq("id", orderId).maybeSingle();
  if (!o || !o.email || o.emailed_at) return false;
  const [{ data: ev }, { data: tix }, { data: types }, { data: nights }] = await Promise.all([
    db.from("events").select("slug,name,venue,address,age").eq("id", o.event_id).single(),
    db.from("tickets").select("code,token,type_id,holder_name").eq("order_id", o.id).eq("status", "valid").order("created_at"),
    db.from("ticket_types").select("id,name,night_ids").eq("event_id", o.event_id),
    db.from("ticket_nights").select("id,label,starts_at,ends_at").eq("event_id", o.event_id).order("sort"),
  ]);
  if (!ev || !tix?.length) return false;
  const ns = nights || [];
  const r = renderTicketEmail({
    comp: o.status === "comp", buyerName: o.name, eventName: ev.name, venue: ev.venue, address: ev.address, age: ev.age,
    nights: ns.map((n) => ({ label: n.label, doors: doorsText(n.starts_at, n.ends_at) })),
    tickets: tix.map((t) => {
      const ty = types?.find((x) => x.id === t.type_id);
      const idx = (ty?.night_ids || []).map((id: string) => ns.findIndex((n) => n.id === id)).filter((i: number) => i >= 0);
      const one = idx.length === 1 ? ns[idx[0]] : null;
      return { typeName: ty?.name || "Ticket", nightIdx: idx,
        nightLabels: one ? (doorsText(one.starts_at, one.ends_at) || one.label) : idx.map((i: number) => ns[i].label).join(" + "),
        holder: t.holder_name, code: t.code, ticketUrl: TICKET_PAGE(t.token), qrUrl: QR_URL(t.token) };
    }),
    subtotalCents: o.subtotal_cents, discountCents: o.discount_cents, feeCents: o.fee_cents, totalCents: o.total_cents,
    contactEmail: CONFIG.contactEmail, mailingAddress: CONFIG.mailingAddress, siteUrl: SITE_URL, eventUrl: `${SITE_URL}/${ev.slug === "underground" ? "underground/" : "tickets.html?e=" + ev.slug}`,
  });
  const res = await provider.send({
    to: { email: o.email, name: o.name }, subject: r.subject, html: r.html, text: r.text, tags: ["tickets"],
    fromName: Deno.env.get("TICKETS_FROM_NAME") || "T.O.F.T.U. Tickets",
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
