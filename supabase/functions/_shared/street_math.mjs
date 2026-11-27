// Street-team links. Pure math, no database.
// A named ?ref= on a show counts paid tickets and ticket revenue.
// A payout is what the promoter owes that person. Subduction does not move it.
// Refunded and comped tickets add nothing.

export function normRef(s) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

export function streetLine() {
  return "Share a link for this show. Tickets bought through it show up here. If you set a payout, that is what you owe them per paid ticket. You pay it yourself. Subduction does not move that money. Refunded tickets and guest-list tickets are left out.";
}

export function planLink(input) {
  const label = String((input && input.label) || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!label) return { error: "Give the link a name." };
  const code = normRef((input && input.code) ? input.code : label);
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(code)) return { error: "Use letters, numbers, and dashes in the code." };
  const raw = input && input.payout;
  if (raw == null || String(raw).trim() === "") return { label, code, payout_cents: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1000) return { error: "Payout needs to be a dollar amount up to $1000." };
  return { label, code, payout_cents: Math.round(n * 100) };
}

// Net ticket money for the tickets that still count, after a share of the order discount.
export function orderShare(order, tickets) {
  const none = { tickets: 0, revenue: 0 };
  if (!order || order.status !== "paid") return none;
  const list = Array.isArray(tickets) ? tickets : [];
  let qualGross = 0;
  let qualCount = 0;
  let baseGross = 0;
  if (list.length) {
    for (const t of list) {
      if (!t || t.is_comp || !(Number(t.unit_cents) > 0)) continue;
      baseGross += Number(t.unit_cents);
      if (t.status === "valid") { qualGross += Number(t.unit_cents); qualCount += 1; }
    }
  } else {
    const items = Array.isArray(order.items) ? order.items : [];
    for (const it of items) {
      const qty = Number(it.qty) || 0;
      const unit = Number(it.unit_cents) || 0;
      if (qty > 0 && unit > 0) { qualCount += qty; qualGross += qty * unit; baseGross += qty * unit; }
    }
  }
  if (qualCount <= 0 || baseGross <= 0) return none;
  const discount = Math.min(Math.max(0, Number(order.discount_cents) || 0), baseGross);
  const off = Math.round(discount * qualGross / baseGross);
  return { tickets: qualCount, revenue: Math.max(0, qualGross - off) };
}

export function rollup(links, orders, ticketsByOrder) {
  const buckets = new Map();
  for (const link of links || []) {
    buckets.set(link.code, { id: link.id, code: link.code, label: link.label, payout_cents: link.payout_cents, saved: true, tickets: 0, revenue_cents: 0 });
  }
  const extras = new Map();
  for (const order of orders || []) {
    const code = normRef(order && order.ref);
    if (!code) continue;
    const part = orderShare(order, (ticketsByOrder && ticketsByOrder[order.id]) || []);
    if (part.tickets <= 0) continue;
    let row = buckets.get(code);
    if (!row) {
      row = extras.get(code);
      if (!row) {
        row = { id: null, code, label: code, payout_cents: null, saved: false, tickets: 0, revenue_cents: 0 };
        extras.set(code, row);
      }
    }
    row.tickets += part.tickets;
    row.revenue_cents += part.revenue;
  }
  return [...buckets.values(), ...extras.values()].map((row) => ({
    ...row,
    owed_cents: row.payout_cents == null ? null : row.tickets * row.payout_cents,
  }));
}
