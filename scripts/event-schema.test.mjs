// Locks Event markup to approved promoter shows, the checkout price, and the T.O.F.T.U. hold.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allInCents, currentTier, eventJsonLd, offerInputs, schemaHeld, TOFTU_ID, TOFTU_SCHEMA_AFTER, TOFTU_SLUG } from "../supabase/functions/shows/schema.mjs";

assert.equal(allInCents(2500, 150), 2761);
assert.equal(allInCents(0, 150), 0);
assert.equal(allInCents(2500, 0), 2606);

const before = TOFTU_SCHEMA_AFTER - 1000;
const after = TOFTU_SCHEMA_AFTER + 1000;
assert.equal(schemaHeld(TOFTU_ID, "other", before), true);
assert.equal(schemaHeld("11111111-1111-1111-1111-111111111111", TOFTU_SLUG, before), true);
assert.equal(schemaHeld(TOFTU_ID, TOFTU_SLUG, after), false);
assert.equal(schemaHeld("11111111-1111-1111-1111-111111111111", "nightshift", before), false);

const base = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  slug: "nightshift",
  name: "Night Shift",
  reviewStatus: "approved",
  legacyStripe: false,
  venue: "The Room",
  city: "Peoria",
  address: "100 Main St",
  locationSecret: false,
  description: "Two rooms. One night.",
  salesOpen: true,
  startsAt: null,
  shareUrl: "https://cdn.example/share.jpg",
  posterUrl: "http://insecure.example/nope.jpg",
  heroUrl: "/relative.jpg",
  nights: [{ starts_at: "2026-12-05T20:00:00-06:00", ends_at: "2026-12-06T02:00:00-06:00" }],
  offers: [{ name: "General admission", priceCents: 2500, soldOut: false }],
  feePerTicket: 150,
  pageUrl: "https://subduction.art",
  organizerName: "North Crew",
};

const ev = eventJsonLd(base, before);
assert.equal(ev["@type"], "Event");
assert.equal(ev.name, "Night Shift");
assert.equal(ev.startDate, "2026-12-05T20:00:00-06:00");
assert.equal(ev.endDate, "2026-12-06T02:00:00-06:00");
assert.equal(ev.url, "https://subduction.art/nightshift");
assert.equal(ev.location.name, "The Room");
assert.equal(ev.location.address.streetAddress, "100 Main St");
assert.equal(ev.location.address.addressLocality, "Peoria");
assert.deepEqual(ev.image, ["https://cdn.example/share.jpg"]);
assert.equal(ev.offers.price, "27.61");
assert.equal(ev.offers.priceCurrency, "USD");
assert.equal(ev.offers.url, "https://subduction.art/nightshift");
assert.equal(ev.offers.availability, "https://schema.org/InStock");
assert.equal(ev.organizer.name, "North Crew");

const secretAddr = "742 Evergreen Terrace";
const secret = eventJsonLd({ ...base, locationSecret: true, address: secretAddr, venue: "Real Venue Name" }, before);
assert.equal(JSON.stringify(secret).includes(secretAddr), false);
assert.equal(JSON.stringify(secret).includes("Real Venue Name"), false);
assert.equal(secret.location.name, "Secret location");
assert.equal(secret.location.address.streetAddress, undefined);
assert.equal(secret.location.address.addressLocality, "Peoria");

assert.equal(eventJsonLd({ ...base, reviewStatus: "submitted" }, before), null);
assert.equal(eventJsonLd({ ...base, legacyStripe: true }, before), null);
assert.equal(eventJsonLd({ ...base, nights: [], startsAt: null }, before), null);
assert.equal(eventJsonLd({ ...base, id: TOFTU_ID, slug: TOFTU_SLUG }, before), null);
assert.equal(eventJsonLd({ ...base, id: TOFTU_ID, slug: TOFTU_SLUG, legacyStripe: false }, after)["@type"], "Event");
assert.equal(eventJsonLd({ ...base, id: TOFTU_ID, slug: TOFTU_SLUG, legacyStripe: true }, after), null);
assert.equal(eventJsonLd({ ...base, feePerTicket: null }, before).offers, undefined);

const heldBack = eventJsonLd({ ...base, salesOpen: false, offers: [{ name: "GA", priceCents: 2500, soldOut: false }] }, before);
assert.equal(heldBack.offers.availability, "https://schema.org/PreOrder");
const gone = eventJsonLd({ ...base, offers: [{ name: "GA", priceCents: 2500, soldOut: true }] }, before);
assert.equal(gone.offers.availability, "https://schema.org/SoldOut");

assert.deepEqual(currentTier([{ name: "Early", price_cents: 2000, qty: 10 }, { name: "Door", price_cents: 3000, qty: 40 }], 10), {
  tier: { name: "Door", price_cents: 3000, qty: 40 }, soldOut: false,
});
assert.equal(currentTier([{ name: "Early", price_cents: 2000, qty: 10 }], 10).soldOut, true);
const offers = offerInputs([
  { id: "a", slug: "ga", name: "GA", on_sale: true, tiers: [{ price_cents: 2500, qty: 5 }] },
  { id: "b", slug: "test", name: "Test", on_sale: true, tiers: [{ price_cents: 100, qty: 5 }] },
  { id: "c", slug: "artist", name: "Artist", on_sale: true, tiers: [{ price_cents: 0, qty: 5 }] },
  { id: "d", slug: "vip", name: "VIP", on_sale: false, tiers: [{ price_cents: 5000, qty: 5 }] },
], { a: 0 });
assert.deepEqual(offers.map((o) => o.name), ["GA"]);

const root = new URL("..", import.meta.url);
const tickets = readFileSync(new URL("site/tickets.html", root), "utf8");
// Dylan approved a static, venue-free Event block on /underground/ for search (issue #68):
// two nights, "Secret Location", no street, no price. Anything else stays out.
const ld = tickets.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert.ok(ld, "tickets.html carries the T.O.F.T.U. Event markup");
assert.equal(tickets.split("application/ld+json").length, 2);
const nights = JSON.parse(ld[1]);
assert.deepEqual(nights.map((n) => [n.startDate, n.endDate]), [
  ["2027-01-08T18:00:00-06:00", "2027-01-09T01:00:00-06:00"],
  ["2027-01-09T18:00:00-06:00", "2027-01-10T01:00:00-06:00"],
]);
for (const n of nights) {
  assert.equal(n.location.name, "Secret Location");
  assert.equal(n.location.address.streetAddress, undefined);
  assert.equal(n.offers.price, undefined);
  assert.equal(n.offers.url, "https://subduction.art/underground/");
}
const build = readFileSync(new URL("scripts/build.mjs", root), "utf8");
assert.match(build, /join\(out, "underground", "index.html"\)[\s\S]{0,220}tickets\.html/);
assert.match(build, /63b511f3-d838-404f-9c2e-5d4b98fbf013/);
assert.match(build, /2027-01-10T00:00:00-06:00/);
const show = readFileSync(new URL("site/assets/show.js", root), "utf8");
assert.match(show, /slug === "underground"\) \{ location\.replace\("tickets\.html/);
assert.match(show, /2027-01-10T00:00:00-06:00/);
assert.equal(show.includes("schema.org/Event"), false);
const fn = readFileSync(new URL("supabase/functions/shows/index.ts", root), "utf8");
assert.equal(fn.includes("address_full"), false);
assert.equal(fn.includes("venue_full"), false);
const helper = readFileSync(new URL("supabase/functions/shows/schema.mjs", root), "utf8");
assert.equal(helper.includes("address_full"), false);
