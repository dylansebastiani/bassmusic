// Address reveal: the pure rules, with every outside effect passed in so scripts/reveal.test.mjs can
// simulate a whole run. T.O.F.T.U. (slug "underground") is excluded here, in the query, and in the sender.
export const TOFTU_SLUG = "underground";
export const TOFTU_ID = "63b511f3-d838-404f-9c2e-5d4b98fbf013";

export const isToftu = (ev) => !!ev && (ev.slug === TOFTU_SLUG || ev.id === TOFTU_ID);

// A show is due only when it is secret, its reveal time has passed, nothing was sent yet, and it isn't T.O.F.T.U.
export function isDue(ev, now = new Date()) {
  if (!ev || isToftu(ev)) return false;
  if (!ev.location_secret || ev.reveal_sent_at) return false;
  if (!ev.address_reveal_at) return false;
  const at = Date.parse(ev.address_reveal_at);
  return Number.isFinite(at) && at <= now.getTime();
}

// The real place: the held-back columns first, then the public ones. Nothing to send without an address.
export function place(ev) {
  const address = (ev.address_full || ev.address || "").trim();
  const venue = (ev.venue_full || ev.venue || "").trim();
  return address ? { venue, address } : null;
}

// deps: { events(): rows, orders(eventId): [{id,...}], send(ev, order, place): bool, claim(orderId): bool,
//         unclaim(orderId), done(eventId): void }
export async function runReveal(deps, now = new Date()) {
  const out = { shows: 0, sent: 0, failed: 0, skipped: 0 };
  for (const ev of await deps.events()) {
    if (!isDue(ev, now)) { out.skipped++; continue; }
    const where = place(ev);
    if (!where) { out.skipped++; continue; }
    out.shows++;
    let failed = 0;
    for (const o of await deps.orders(ev.id)) {
      if (!(await deps.claim(o.id))) continue;            // someone else already sent this order
      let ok = false;
      try { ok = isToftu(ev) ? false : await deps.send(ev, o, where); } catch { ok = false; }
      if (ok) out.sent++; else { failed++; out.failed++; await deps.unclaim(o.id); }
    }
    if (!failed) await deps.done(ev.id);                    // only a clean run closes the show
  }
  return out;
}
