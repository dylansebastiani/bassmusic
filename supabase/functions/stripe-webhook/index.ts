import { db } from "../_shared/db.ts";
import { verifyStripe, sendTickets } from "../_shared/tickets.ts";

// Stripe calls this when a checkout finishes, expires, or a payment is refunded.
// Every event is checked against the signing secret first; anything unsigned is dropped.
//   checkout.session.completed -> make the tickets and email them
//   checkout.session.expired   -> release the hold so those tickets go back on sale
//   charge.refunded            -> void that order's tickets (full refunds only)
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const raw = await req.text();
  if (!(await verifyStripe(raw, req.headers.get("stripe-signature")))) return new Response("bad signature", { status: 400 });
  let ev: { type: string; data: { object: Record<string, any> } };
  try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const obj = ev.data?.object || {};

  if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
    if (obj.payment_status !== "paid") return new Response("waiting for payment", { status: 200 });
    const orderId = obj.metadata?.order_id || obj.client_reference_id;
    const { data: o } = await db.from("ticket_orders").select("id,status,total_cents").eq("id", orderId).maybeSingle();
    if (!o) { console.error("webhook: no order for session", obj.id); return new Response("no order", { status: 200 }); }
    if (o.status === "refunded") return new Response("refunded", { status: 200 });
    // Belt and braces: tickets only for a payment that covers the whole order.
    if (typeof obj.amount_total === "number" && obj.amount_total < o.total_cents) {
      console.error("webhook: paid less than the order total", o.id, obj.amount_total, o.total_cents);
      return new Response("amount mismatch", { status: 200 });
    }
    await db.from("ticket_orders").update({ stripe_payment_intent: obj.payment_intent || null, stripe_session_id: obj.id }).eq("id", o.id);
    const { error } = await db.rpc("ticket_issue", { p_order: o.id, p_status: "paid" });
    if (error) { console.error("webhook: issue failed", o.id, error.message); return new Response("retry", { status: 500 }); }
    await sendTickets(o.id);   // if the email fails, the buyer still sees the tickets on the return page
    return new Response("ok", { status: 200 });
  }

  if (ev.type === "checkout.session.expired") {
    const orderId = obj.metadata?.order_id || obj.client_reference_id;
    await db.from("ticket_orders").update({ status: "expired", hold_until: null }).eq("id", orderId).eq("status", "pending");
    return new Response("ok", { status: 200 });
  }

  if (ev.type === "charge.refunded") {
    if (!obj.refunded) return new Response("partial refund, tickets kept", { status: 200 });
    const { data: o } = await db.from("ticket_orders").select("id").eq("stripe_payment_intent", obj.payment_intent).maybeSingle();
    if (o) {
      await db.from("ticket_orders").update({ status: "refunded" }).eq("id", o.id);
      await db.from("tickets").update({ status: "void" }).eq("order_id", o.id);
    }
    return new Response("ok", { status: 200 });
  }

  return new Response("ignored", { status: 200 });
});
