// Simulates the address reveal: never T.O.F.T.U., never before address_reveal_at, never twice.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runReveal, isDue, TOFTU_ID } from "../supabase/functions/reveal/core.mjs";

const now = new Date("2027-02-01T12:00:00Z");
const past = "2027-02-01T11:00:00Z", future = "2027-02-01T13:00:00Z";
const base = { location_secret: true, reveal_sent_at: null, address_full: "9 Back Alley", venue_full: "The Cellar" };
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
// Wiring: the query, the guard, and the migration all name T.O.F.T.U.
const src = readFileSync(new URL("../supabase/functions/reveal/index.ts", import.meta.url), "utf8");
assert.match(src, /neq\("slug", TOFTU_SLUG\)/); assert.match(src, /isToftu\(ev\)/); assert.match(src, /x-runner-secret/);
const mig = readFileSync(new URL("../supabase/migrations/0055_reveal_sent.sql", import.meta.url), "utf8");
assert.match(mig, /slug <> 'underground'/); assert.match(mig, /cron\.schedule\('address-reveal', '\*\/15/);
console.log("reveal test passed");
