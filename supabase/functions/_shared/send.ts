// Shared by the webhook and door functions: turn an order into the branded ticket email and send it.
import { db } from "./db.ts";
import { SITE_URL, CONFIG } from "./config.ts";
import { brevo as provider } from "./email/brevo.ts";   // <- swap provider here
import { renderTicketEmail, renderLocationEmail } from "./ticket_email.ts";
import { renderTicketPdf, type PdfTicket } from "./ticket_pdf.ts";

export const FN_URL = (Deno.env.get("SUPABASE_URL") || "https://hxfuelulxsituzcgsvhg.supabase.co") + "/functions/v1";
export const TICKET_PAGE = (token: string) => `${SITE_URL}/ticket.html?t=${token}`;
export const QR_URL = (token: string) => `${FN_URL}/tickets?a=qr&t=${token}`;

const doorsText = (starts: string | null, ends: string | null) => {
  if (!starts) return null;
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(":00", "");
  return "Doors " + t(starts) + (ends ? " – " + t(ends) : "");
};

// "Fri Jan 1 at 12 PM" (Chicago time): when a held-back secret address drops.
export const revealLabel = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso), o = { timeZone: "America/Chicago" } as const;
  const day = d.toLocaleDateString("en-US", { ...o, weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  return day + " at " + d.toLocaleTimeString("en-US", { ...o, hour: "numeric", minute: "2-digit" }).replace(":00", "");
};
// Until the reveal time passes, the address stays off tickets and emails (events.address is empty then).
const heldBack = (ev: { address: string | null; location_secret?: boolean; address_reveal_at?: string | null }) =>
  !ev.address && !!ev.location_secret && !!ev.address_reveal_at ? revealLabel(ev.address_reveal_at) : null;

export const orderRef = (id: string) => "TOFTU-" + id.replace(/-/g, "").slice(0, 4).toUpperCase();
export function b64(bytes: Uint8Array) {
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// PDF tickets for any set of tickets from one order (the email attaches all of them; the ticket page asks for one).
export async function ticketsPdf(orderId: string, onlyToken?: string) {
  const { data: o } = await db.from("ticket_orders").select("id,event_id,status").eq("id", orderId).maybeSingle();
  if (!o) return null;
  const [{ data: ev }, { data: tix }, { data: types }, { data: nights }] = await Promise.all([
    db.from("events").select("name,venue,address,age,location_secret,address_reveal_at").eq("id", o.event_id).single(),
    db.from("tickets").select("code,token,type_id,holder_name,tier,is_comp").eq("order_id", o.id).eq("status", "valid").order("created_at"),
    db.from("ticket_types").select("id,name,night_ids").eq("event_id", o.event_id),
    db.from("ticket_nights").select("id,label,starts_at,ends_at").eq("event_id", o.event_id).order("sort"),
  ]);
  if (!ev || !tix?.length) return null;
  const ns = nights || [];
  const list = onlyToken ? tix.filter((t) => t.token === onlyToken) : tix;
  if (!list.length) return null;
  const tickets: PdfTicket[] = list.map((t) => {
    const ty = types?.find((x) => x.id === t.type_id);
    const idx = (ty?.night_ids || []).map((id: string) => ns.findIndex((n) => n.id === id)).filter((i: number) => i >= 0);
    const one = idx.length === 1 ? ns[idx[0]] : null;
    return { typeName: ty?.name || "Ticket", nightIdx: idx, nightLabels: idx.map((i: number) => ns[i].label).join(" + "),
      doors: one ? doorsText(one.starts_at, one.ends_at) : (ns[0] ? doorsText(ns[0].starts_at, ns[0].ends_at) + " both nights" : null),
      holder: t.holder_name, code: t.code, tier: t.tier, ticketUrl: TICKET_PAGE(t.token), comp: t.is_comp };
  });
  return await renderTicketPdf({ eventName: ev.name, venue: ev.venue, address: ev.address, age: ev.age, orderRef: orderRef(o.id), tickets, siteUrl: SITE_URL, revealText: heldBack(ev) });
}

export async function sendTickets(orderId: string) {
  const { data: o } = await db.from("ticket_orders").select("id,event_id,email,name,status,subtotal_cents,discount_cents,fee_cents,total_cents,emailed_at").eq("id", orderId).maybeSingle();
  if (!o || !o.email || o.emailed_at) return false;
  const [{ data: ev }, { data: tix }, { data: types }, { data: nights }] = await Promise.all([
    db.from("events").select("slug,name,venue,address,age,location_secret,address_reveal_at").eq("id", o.event_id).single(),
    db.from("tickets").select("code,token,type_id,holder_name").eq("order_id", o.id).eq("status", "valid").order("created_at"),
    db.from("ticket_types").select("id,name,night_ids").eq("event_id", o.event_id),
    db.from("ticket_nights").select("id,label,starts_at,ends_at").eq("event_id", o.event_id).order("sort"),
  ]);
  if (!ev || !tix?.length) return false;
  const ns = nights || [];
  const r = renderTicketEmail({
    comp: o.status === "comp", buyerName: o.name, eventName: ev.name, venue: ev.venue, address: ev.address, age: ev.age, revealText: heldBack(ev),
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
  // The PDF rides along when it builds; if it doesn't, the email still goes (the QR codes are in it either way).
  let attachments: { name: string; content: string }[] | undefined;
  try { const pdf = await ticketsPdf(o.id); if (pdf) attachments = [{ name: `${orderRef(o.id)}-tickets.pdf`, content: b64(pdf) }]; }
  catch (e) { console.error("ticket pdf failed", o.id, (e as Error).message); }
  const res = await provider.send({
    to: { email: o.email, name: o.name }, subject: r.subject, html: r.html, text: r.text, tags: ["tickets"], attachments,
    fromName: Deno.env.get("TICKETS_FROM_NAME") || "T.O.F.T.U. Tickets",
  });
  if (res.ok) await db.from("ticket_orders").update({ emailed_at: new Date().toISOString() }).eq("id", o.id);
  else console.error("ticket email failed", o.id, res.error);
  return res.ok;
}


// Reveal day: one email per order with the address, sent once (ticket_orders.location_sent_at).
export async function sendLocation(orderId: string) {
  const { data: o } = await db.from("ticket_orders").select("id,event_id,email,name,status,location_sent_at").eq("id", orderId).maybeSingle();
  if (!o || !o.email || o.location_sent_at || !["paid", "comp"].includes(o.status)) return false;
  const [{ data: ev }, { data: nights }, { count }] = await Promise.all([
    db.from("events").select("slug,name,venue,address,age").eq("id", o.event_id).single(),
    db.from("ticket_nights").select("label,starts_at,ends_at").eq("event_id", o.event_id).order("sort"),
    db.from("tickets").select("id", { count: "exact", head: true }).eq("order_id", o.id).eq("status", "valid"),
  ]);
  if (!ev?.address || !count) return false;
  const r = renderLocationEmail({
    buyerName: o.name, eventName: ev.name, venue: ev.venue, address: ev.address, age: ev.age,
    nights: (nights || []).map((n) => ({ label: n.label, doors: doorsText(n.starts_at, n.ends_at) })),
    contactEmail: CONFIG.contactEmail, siteUrl: SITE_URL,
    eventUrl: `${SITE_URL}/${ev.slug === "underground" ? "underground/" : "tickets.html?e=" + ev.slug}`,
  });
  const res = await provider.send({ to: { email: o.email, name: o.name }, subject: r.subject, html: r.html, text: r.text, tags: ["location"],
    fromName: Deno.env.get("TICKETS_FROM_NAME") || "T.O.F.T.U. Tickets" });
  if (res.ok) await db.from("ticket_orders").update({ location_sent_at: new Date().toISOString() }).eq("id", o.id);
  else console.error("location email failed", o.id, res.error);
  return res.ok;
}
