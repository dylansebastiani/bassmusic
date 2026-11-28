// Simulates the address reveal: never T.O.F.T.U., never before address_reveal_at, never twice.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runReveal, isDue, isHandsOff, TOFTU_ID } from "../supabase/functions/reveal/core.mjs";

const now = new Date("2027-02-01T12:00:00Z");
const past = "2027-02-01T11:00:00Z", future = "2027-02-01T13:00:00Z";
const base = { company: { slug: "promo-co", legacy_stripe: false }, location_secret: true, reveal_sent_at: null, address_full: "9 Back Alley", venue_full: "The Cellar" };
const world = () => ({
  events: [
    { ...base, id: "a", slug: "promo-due", address_reveal_at: past },
    { ...base, id: "b", slug: "promo-later", address_reveal_at: future },
    { ...base, id: "c", slug: "underground", address_reveal_at: past },
    { ...base, id: TOFTU_ID, slug: "renamed", address_reveal_at: past },
    { ...base, id: "d", slug: "public-show", location_secret: false, address_reveal_at: past },
  ],
  orders: {}, sent: [],
});
function deps(w) {
  const claimed = new Set();
  for (const e of w.events) w.orders[e.id] = [{ id: e.id + "1" }, { id: e.id + "2" }];
  return {
    events: async () => w.events,
    orders: async (id) => w.orders[id].filter((o) => !claimed.has(o.id)),
    claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)),
    unclaim: async (id) => claimed.delete(id),
    send: async (ev, o) => (w.sent.push(ev.id + ":" + o.id), true),
    done: async (id) => { w.events.find((e) => e.id === id).reveal_sent_at = now.toISOString(); },
  };
}

const w = world(), d = deps(w);
const r1 = await runReveal(d, now);
assert.deepEqual(w.sent.sort(), ["a:a1", "a:a2"], "only the due promoter show sends");   // never underground, never early
assert.equal(r1.sent, 2);
assert.ok(w.events[0].reveal_sent_at);
const r2 = await runReveal(d, now);                                                      // rerun: nothing again
assert.equal(w.sent.length, 2); assert.equal(r2.sent, 0);
// A failed send is released and retried, and the show stays open until it is clean.
const w2 = world(), d2 = deps(w2); let fail = true;
d2.send = async (ev, o) => { if (fail && o.id === "a2") return false; w2.sent.push(ev.id + ":" + o.id); return true; };
await runReveal(d2, now); assert.equal(w2.events[0].reveal_sent_at, null);
fail = false; await runReveal(d2, now);
assert.deepEqual(w2.sent.sort(), ["a:a1", "a:a2"]); assert.ok(w2.events[0].reveal_sent_at);
// The rule itself, and the guard even if a bad query handed T.O.F.T.U. over.
assert.equal(isDue({ ...base, id: "x", slug: "underground", address_reveal_at: past }, now), false);
assert.equal(isDue({ ...base, id: TOFTU_ID, slug: "x", address_reveal_at: past }, now), false);
assert.equal(isDue({ ...base, id: "x", slug: "x", address_reveal_at: future }, now), false);
assert.equal(isDue({ ...base, id: "x", slug: "x", address_reveal_at: past }, now), true);
// Hands-off companies (legacy_stripe, quantum) and shows with no company are never due.
const due = { id: "x", slug: "x", address_reveal_at: past };
assert.equal(isDue({ ...base, ...due, company: { slug: "quantum", legacy_stripe: false } }, now), false);
assert.equal(isDue({ ...base, ...due, company: { slug: "old", legacy_stripe: true } }, now), false);
assert.equal(isDue({ ...base, ...due, company: null }, now), false);
assert.equal(isHandsOff(base), false);
{ const w3 = world(); w3.events.push({ ...base, id: "q", slug: "q-show", address_reveal_at: past, company: { slug: "quantum", legacy_stripe: false } },
    { ...base, id: "l", slug: "l-show", address_reveal_at: past, company: { slug: "old", legacy_stripe: true } });
  const d3 = deps(w3); await runReveal(d3, now);
  assert.deepEqual(w3.sent.sort(), ["a:a1", "a:a2"], "hands-off companies never send"); }
// More than one batch: the show closes only once orders() comes back empty, and every order gets the email.
{ const w4 = world(); w4.events = [w4.events[0]];
  const claimed = new Set(); const all = Array.from({ length: 1200 }, (_, i) => ({ id: "o" + i })); let calls = 0;
  const d4 = { ...deps(w4), orders: async () => (calls++, all.filter((o) => !claimed.has(o.id)).slice(0, 500)),
    claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)), unclaim: async (id) => claimed.delete(id),
    send: async (ev, o) => (w4.sent.push(o.id), true) };
  const r = await runReveal(d4, now);
  assert.equal(r.sent, 1200); assert.equal(w4.sent.length, 1200); assert.ok(calls >= 4, "asked until empty");
  assert.ok(w4.events[0].reveal_sent_at, "done after the last batch"); }
// A permanently failing order doesn't loop forever and keeps the show open.
{ const w5 = world(); w5.events = [w5.events[0]]; const d5 = deps(w5); d5.send = async () => false;
  const r = await runReveal(d5, now); assert.equal(r.failed, 2); assert.equal(w5.events[0].reveal_sent_at, null); }
// Wiring: the query, the guard, and the migration all name T.O.F.T.U.
const src = readFileSync(new URL("../supabase/functions/reveal/index.ts", import.meta.url), "utf8");
assert.match(src, /neq\("slug", TOFTU_SLUG\)/); assert.match(src, /isToftu\(ev\)/); assert.match(src, /x-runner-secret/);
assert.match(src, /\.in\("status", \["paid", "comp"\]\)/); assert.match(src, /legacy_stripe/);
const mig = readFileSync(new URL("../supabase/migrations/0055_reveal_sent.sql", import.meta.url), "utf8");
assert.match(mig, /slug <> 'underground'/); assert.match(mig, /cron\.schedule\('address-reveal', '\*\/15/);
console.log("reveal test passed");
