// Promoter referral credit. Pure math, no database.
// A referred crew earns the referrer a share of Subduction's buyer fee on paid tickets
// from their earliest shows. Refunded and comped tickets add nothing.
// The live show is never a source of credit.

export const UNDERGROUND_EVENT_ID = "63b511f3-d838-404f-9c2e-5d4b98fbf013";
export const NOTE_DRIFT = "Paid tickets changed after this was marked paid. The owed amount stays at the marked figure.";
export const NOTE_VOID = "This show no longer has paid tickets that count.";

export function usd(cents) {
  const n = Number(cents) || 0;
  return "$" + (n / 100).toFixed(2);
}

// showLimit 1 is the first show. A later setting of 3 covers the first three.
export function creditLine(showLimit, shareBps, usualFeeCents) {
  const n = showLimit === 1 ? 1 : showLimit;
  const shows = n === 1 ? "their first show" : "their first " + n + " shows";
  const those = n === 1 ? "that show" : "those shows";
  const share = shareBps === 5000 ? "half" : (shareBps / 100).toFixed(shareBps % 100 ? 2 : 0).replace(/\.00$/, "") + "%";
  let money = "";
  if (typeof usualFeeCents === "number" && usualFeeCents > 0 && shareBps > 0) {
    money = " The usual fee is " + usd(usualFeeCents) + ", so that is " + usd(Math.round(usualFeeCents * shareBps / 10000)) + " a ticket.";
  }
  return "Share this. When a promoter who joins from it runs " + shows + ", you earn " + share +
    " of Subduction's buyer fee on each paid ticket from " + those + "." + money +
    " It comes out of Subduction's share. Dylan pays it. Nothing is sent on its own. Refunded tickets and guest-list tickets are left out.";
}

export function qualifyingTicket(t) {
  return !!t && t.status === "valid" && !t.is_comp && (Number(t.unit_cents) || 0) > 0;
}

function paidQty(order) {
  const items = Array.isArray(order && order.items) ? order.items : [];
  return items.reduce((s, it) => s + ((Number(it.unit_cents) > 0 ? Number(it.qty) || 0 : 0)), 0);
}

// Share of this order's platform fee. Comps, refunds, and a $0 fee contribute nothing.
export function orderCredit(order, tickets, shareBps) {
  const none = { tickets: 0, fee: 0, credit: 0 };
  if (!order || order.status !== "paid" || !(Number(order.platform_fee_cents) > 0) || !(Number(shareBps) > 0)) return none;
  const list = Array.isArray(tickets) ? tickets : [];
  let qual = 0;
  let base = 0;
  if (list.length) {
    for (const t of list) {
      if (!t || t.is_comp || !(Number(t.unit_cents) > 0)) continue;
      base += 1;
      if (qualifyingTicket(t)) qual += 1;
    }
  } else {
    qual = base = paidQty(order);
  }
  if (qual <= 0 || base <= 0) return none;
  const fee = Math.round(Number(order.platform_fee_cents) * qual / base);
  const credit = Math.round(fee * Number(shareBps) / 10000);
  return { tickets: qual, fee, credit };
}

export function isCountedShow(event) {
  if (!event) return false;
  if (event.id === UNDERGROUND_EVENT_ID || event.slug === "underground") return false;
  if (event.legacy) return false;
  return true;
}

// The first show is the first one that sells a paid ticket. A later setting of 3
// adds the next shows that sell, in the order those sales started.
// A full refund drops a still-pending show out of the list. A settled row is left as it was.
export function creditsForReferral(opts) {
  const events = opts.events || [];
  const orders = opts.orders || [];
  const ticketsByOrder = opts.ticketsByOrder || {};
  const shareBps = Number(opts.shareBps) || 0;
  const showLimit = Math.max(0, Number(opts.showLimit) || 0);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const acc = new Map();
  for (const o of orders) {
    if (!o || !isCountedShow(eventById.get(o.event_id))) continue;
    const part = orderCredit(o, ticketsByOrder[o.id] || [], shareBps);
    if (part.tickets <= 0 || part.credit <= 0) continue;
    const cur = acc.get(o.event_id) || { event_id: o.event_id, tickets: 0, fee: 0, credit: 0, firstPaid: o.paid_at || "" };
    cur.tickets += part.tickets;
    cur.fee += part.fee;
    cur.credit += part.credit;
    if (o.paid_at && (!cur.firstPaid || o.paid_at < cur.firstPaid)) cur.firstPaid = o.paid_at;
    acc.set(o.event_id, cur);
  }
  return [...acc.values()]
    .sort((a, b) => (a.firstPaid || "").localeCompare(b.firstPaid || "") || a.event_id.localeCompare(b.event_id))
    .slice(0, showLimit)
    .map((v, i) => ({ event_id: v.event_id, show_rank: i + 1, tickets: v.tickets, fee: v.fee, credit: v.credit }));
}

// Settled rows stay at the marked amount. Pending rows follow the live tickets.
export function ledgerWrites(existing, desired) {
  const want = new Map((desired || []).map((d) => [d.event_id, d]));
  const writes = [];
  const seen = new Set();
  for (const prev of existing || []) {
    const d = want.get(prev.event_id);
    seen.add(prev.event_id);
    if (prev.status === "settled") {
      if (!d || prev.paid_tickets !== d.tickets || prev.credit_cents !== d.credit) writes.push({ op: "note", id: prev.id, note: NOTE_DRIFT });
      continue;
    }
    if (!d) {
      if (prev.status !== "void" || prev.credit_cents !== 0) {
        writes.push({ op: "void", id: prev.id, paid_tickets: 0, fee_cents: 0, credit_cents: 0, status: "void", note: NOTE_VOID });
      }
      continue;
    }
    if (prev.status !== "pending" || prev.paid_tickets !== d.tickets || prev.fee_cents !== d.fee || prev.credit_cents !== d.credit || prev.show_rank !== d.show_rank) {
      writes.push({ op: "update", id: prev.id, show_rank: d.show_rank, paid_tickets: d.tickets, fee_cents: d.fee, credit_cents: d.credit, status: "pending", note: null });
    }
  }
  for (const d of desired || []) {
    if (seen.has(d.event_id)) continue;
    writes.push({ op: "insert", event_id: d.event_id, show_rank: d.show_rank, paid_tickets: d.tickets, fee_cents: d.fee, credit_cents: d.credit, status: "pending", note: null });
  }
  return writes;
}
