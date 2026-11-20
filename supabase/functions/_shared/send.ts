// Shared by the webhook and door functions: turn an order into the branded ticket email and send it.
import { db } from "./db.ts";
import { SITE_URL, CONFIG } from "./config.ts";
import { brevo as provider } from "./email/brevo.ts";   // <- swap provider here
import { renderTicketEmail } from "./ticket_email.ts";

export const FN_URL = (Deno.env.get("SUPABASE_URL") || "https://hxfuelulxsituzcgsvhg.supabase.co") + "/functions/v1";
export const TICKET_PAGE = (token: string) => `${SITE_URL}/ticket.html?t=${token}`;
export const QR_URL = (token: string) => `${FN_URL}/tickets?a=qr&t=${token}`;

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

