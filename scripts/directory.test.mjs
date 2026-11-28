// Locks the directory rules: pending stays off the list, T.O.F.T.U. is only a link,
// the honeypot matches the promoter form, and the submitter is never a recipient.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  alertRecipients, canReplyTo, chicagoYmd, cityPath, dateOk, externalCard, honeypotFilled,
  isFresh, leadMail, matches, normTicketUrl, publicCard, splitPlace, subductionCard, ticketLink,
} from "../supabase/functions/directory/listing.mjs";

const today = "2026-11-26";
const underground = {
  slug: "underground", name: "THIS ONE IS FOR THE UNDERGROUND", city: "Peoria, IL",
  venue: "Secret location", location_secret: true, review_status: "approved",
  sales_open: true, page_published_at: null, starts_at: "2027-01-09T00:00:00Z",
  is_active: true, is_public: true, address: "123 Hidden St", address_full: "123 Hidden St",
};
const nights = [{ starts_at: "2027-01-09T00:00:00Z" }, { starts_at: "2027-01-10T00:00:00Z" }];
const card = subductionCard(underground, nights, today);
assert.ok(card);
assert.equal(card.url, "/underground/");
assert.equal(card.secret, true);
assert.equal("venue" in card, false);
assert.equal(card.name, "T.O.F.T.U.");
assert.equal(card.city, "Peoria");
assert.equal(card.state, "IL");
assert.deepEqual(card.dates, ["2027-01-08", "2027-01-09"]);
assert.equal(card.when, "Jan 8-9");
assert.equal(card.flyer, "");
assert.equal(JSON.stringify(card).includes("Hidden"), false);

assert.equal(subductionCard({ ...underground, review_status: "submitted" }, nights, today), null);
assert.equal(subductionCard({ ...underground, review_status: "draft" }, nights, today), null);
assert.equal(subductionCard({ ...underground, slug: "zz-lane-test", sales_open: false, page_published_at: null }, [{ starts_at: "2027-02-05T00:00:00Z" }], today), null);
assert.equal(subductionCard(underground, [{ starts_at: "2020-01-01T00:00:00Z" }], today), null);
assert.equal(subductionCard({ ...underground, is_active: false }, nights, today), null);

const listed = externalCard({
  status: "approved", name: "Warehouse", show_date: "2027-03-01", venue: "The Room",
  city: "Chicago", state: "IL", ticket_url: "https://tickets.example/night", flyer_url: "https://cdn.example/f.jpg",
}, today);
assert.ok(listed);
assert.equal(listed.source, "listing");
assert.equal(listed.url, "https://tickets.example/night");
assert.equal(externalCard({ ...listed, status: "pending", show_date: "2027-03-01", ticket_url: listed.url }, today), null);

const pub = publicCard(card);
assert.equal("email" in pub, false);
assert.equal("submitter_email" in pub, false);
assert.equal(pub.path, "peoria-il");
assert.equal(matches(pub, { path: "peoria-il", state: "IL", date: "2027-01-09", q: "peoria" }), true);
assert.equal(matches(pub, { date: "2027-02-01" }), false);
assert.equal(matches(pub, { q: "detroit" }), false);

assert.equal(honeypotFilled({ hp_field: "x" }), true);
assert.equal(honeypotFilled({ website: "http://spam.example" }), true);
assert.equal(honeypotFilled({ company: "bot" }), true);
assert.equal(honeypotFilled({ hp_field: "  ", website: "", company: "" }), false);
assert.equal(normTicketUrl("http://example.com/t"), "");
assert.equal(normTicketUrl("javascript:alert(1)"), "");
assert.equal(normTicketUrl("https://tickets.example/night"), "https://tickets.example/night");

const artistOf = (e) => (e === "artist@example.com" ? true : e === "unknown@example.com" ? null : false);
assert.deepEqual(
  alertRecipients(["dylan@subduction.art", "artist@example.com", "unknown@example.com", "fan@example.com"], "fan@example.com", artistOf),
  ["dylan@subduction.art"],
);
assert.equal(canReplyTo("artist@example.com", artistOf), false);
assert.equal(canReplyTo("unknown@example.com", artistOf), false);
assert.equal(canReplyTo("promoter@example.com", artistOf), true);

const mail = leadMail({
  name: "Night", when: "Fri Jan 8", venue: "The Room", city: "Peoria", state: "IL",
  ticket_url: "https://tickets.example/night", from: "promoter@example.com",
  review_url: "https://subduction.art/shows/review?k=abc",
});
assert.equal(mail.tag, "lead");
assert.equal(mail.fromName, "Subduction leads");
assert.equal("to" in mail, false);
assert.match(mail.text, /Open it: https:\/\/subduction\.art\/shows\/review\?k=abc/);
assert.doesNotMatch(mail.subject + "\n" + mail.text.replace(/\?k=/, "k="), /\?|—|–|;/);

assert.equal(ticketLink("underground"), "/underground/");
assert.equal(ticketLink("other-show"), "/other-show");
assert.deepEqual(splitPlace("Peoria, IL"), { city: "Peoria", state: "IL" });
assert.deepEqual(splitPlace("Peoria IL"), { city: "Peoria", state: "IL" });
assert.equal(chicagoYmd("2027-01-09T00:00:00Z"), "2027-01-08");
assert.equal(dateOk("2026-11-26", today), true);
assert.equal(dateOk("2026-11-25", today), false);
assert.equal(cityPath("Des Moines", "IA"), "des-moines-ia");
assert.equal(cityPath("review", "IL"), "");

// No lineup, crew, venue or address on any public card, and the function never selects them.
const withLineup = subductionCard({ ...underground, slug: "zz-lane-test", venue: "Real Hall", address: "9 Main St" }, [{ starts_at: "2027-01-09T00:00:00Z", lineup: [{ name: "Ace" }], crew: [{ name: "Zed" }] }], today);
assert.equal(publicCard(withLineup).slug, "zz-lane-test");
const FORBIDDEN = /^(lineup|crew|venue|address|address_full|street|location|email|submitter_email)$/i;
function keysOf(o, out = []) {
  if (Array.isArray(o)) o.forEach((x) => keysOf(x, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { out.push(k); keysOf(v, out); }
  return out;
}
const everyCard = [withLineup, card, subductionCard({ ...underground, location_secret: false, venue: "Hangovers" }, nights, today), externalCard({
  status: "approved", name: "W", show_date: "2027-03-01", venue: "The Room", venue_secret: false, city: "Chicago", state: "IL", ticket_url: "https://t.example/x",
}, today), externalCard({
  status: "approved", name: "W", show_date: "2027-03-01", venue: "The Room", venue_secret: true, city: "Chicago", state: "IL", ticket_url: "https://t.example/y",
}, today)].map(publicCard);
for (const c of everyCard) {
  assert.deepEqual(keysOf(c).filter((k) => FORBIDDEN.test(k)), [], "public card has a forbidden field");
  assert.doesNotMatch(JSON.stringify(c), /Real Hall|9 Main|Hangovers|The Room|Ace|Zed|Hidden/);
}
// An outside listing marked secret never prints the typed venue or any email.
const secretListed = externalCard({
  status: "approved", name: "Warehouse", show_date: "2027-03-01", venue: "Real Venue Name", venue_secret: true,
  city: "Chicago", state: "IL", ticket_url: "https://tickets.example/night", submitter_email: "p@example.com",
  reviewed_at: "2026-11-25T12:00:00Z",
}, today, new Date("2026-11-27T12:00:00Z"));
const secretPub = publicCard(secretListed);
assert.equal(secretPub.secret, true);
assert.equal("venue" in secretPub, false);
assert.equal(secretPub.fresh, true);
assert.equal(secretPub.slug, "");
assert.doesNotMatch(JSON.stringify(secretPub), /Real Venue|p@example/);
assert.equal(matches(secretPub, { q: "real venue" }), false);
assert.equal(matches(publicCard(listed), { q: "tickets.example" }), false);
assert.equal(isFresh("2026-01-01T00:00:00Z", new Date("2026-11-27T00:00:00Z")), false);
assert.match(leadMail({ name: "N", when: "Fri", venue: "Real Venue Name", venue_secret: true, city: "C", state: "IL", ticket_url: "https://t.example", from: "p@example.com", review_url: "https://x" }).text, /Real Venue Name/);

// Calendar files: public fields only, built from the public card.
const showsJs = readFileSync(new URL("../site/assets/shows.js", import.meta.url), "utf8");
const ctx = { module: { exports: {} } };
vm.runInNewContext(showsJs, ctx);
const { buildIcs } = ctx.module.exports;
const ics = buildIcs(pub, "https://subduction.art");
assert.match(ics, /LOCATION:Secret location\\, Peoria\\, IL/);
assert.match(ics, /URL:https:\/\/subduction\.art\/underground\//);
assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
assert.doesNotMatch(ics, /Hidden|123|address/i);
const icsOut = buildIcs(publicCard(listed), "https://subduction.art");
assert.match(icsOut, /URL:https:\/\/tickets\.example\/night/);
assert.doesNotMatch(buildIcs(secretPub, "https://subduction.art"), /Real Venue/);
assert.match(buildIcs(secretPub, "https://subduction.art"), /LOCATION:Secret location/);

// Fee copy comes from the shared fee code, never a typed number.
assert.match(showsJs, /F\.feeCents\(2500\)/);
assert.equal(showsJs.includes("1.50"), false);
assert.doesNotMatch(showsJs + readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8"), /Powered by Subduction/);
assert.match(readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8"), /city page \$\{path\} contains a literal/);
const home = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
assert.ok((home.match(/href="\/shows"/g) || []).length >= 2);

const src = readFileSync(new URL("../supabase/functions/directory/index.ts", import.meta.url), "utf8");
const rules = readFileSync(new URL("../supabase/functions/directory/listing.mjs", import.meta.url), "utf8");
const eventsSelect = (src.match(/from\("events"\)\s*\.select\("([^"]*)"/) || [])[1] || "";
assert.ok(eventsSelect.includes("location_secret"));
assert.doesNotMatch(eventsSelect, /address|venue|lineup/);
// The public GET only reads these two functions. Neither may select a venue, lineup or address column.
const publicSrc = src.slice(src.indexOf("async function subductionShows"), src.indexOf("function reviewView"));
for (const sel of publicSrc.matchAll(/\.select\("([^"]*)"\)/g)) assert.doesNotMatch(sel[1], /\b(venue|lineup|crew|address\w*)\b/, "public directory select: " + sel[1]);
assert.doesNotMatch(src + rules, /address_full/);
assert.match(src, /honeypotFilled/);
assert.match(rules, /hp_field/);
assert.match(rules, /slug === "underground"/);
assert.match(src, /alertRecipients/);
assert.match(src, /canReplyTo/);
assert.match(src, /to: to\.map/);
assert.doesNotMatch(src, /email_queue|email-runner|from\("events"\)\.(update|insert|delete)|from\("tickets"\)/);
assert.doesNotMatch(src + rules, /—|–/);

function visible(file) {
  const html = readFileSync(new URL(file, import.meta.url), "utf8");
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
}
const page = visible("../site/shows.html").replace(/\s+/g, " ");
assert.match(page, /Selling tickets for this\? Run it on Subduction/);
assert.doesNotMatch(page.replace("Selling tickets for this? Run it on Subduction", ""), /\?|—|–|;/);
const review = visible("../site/shows-review.html");
assert.doesNotMatch(review, /Selling tickets|—|–|;|\?/);
const showPage = readFileSync(new URL("../site/show.html", import.meta.url), "utf8");
const showJs = readFileSync(new URL("../site/assets/show.js", import.meta.url), "utf8");
assert.doesNotMatch(showPage + showJs, /Run it on Subduction/);

console.log("directory checks passed");

// T.O.F.T.U. card: only the approved fields.
{
  const nf = [{ starts_at: "2027-01-09T00:00:00Z", lineup: [{ name: "Ace" }], flyer_url: "https://cdn.example.com/new-flyer.webp" }];
  const c = subductionCard({ ...underground, location_secret: false, venue: "Hangovers" }, nf, today);
  assert.equal(c.secret, true, "underground is always secret");
  assert.deepEqual(Object.keys(publicCard(c)).sort(), ["city", "dates", "flyer", "fresh", "name", "path", "secret", "slug", "source", "state", "url", "when"]);
  assert.equal(c.name, "T.O.F.T.U.");
  assert.equal(subductionCard(underground, nights, today).when, "Jan 8-9");
  assert.equal(c.city + ", " + c.state, "Peoria, IL");
  assert.equal(c.flyer, "https://cdn.example.com/new-flyer.webp");
  assert.equal(c.url, "/underground/");
  assert.equal(subductionCard(underground, nights, today).flyer, "");
  // The page script gives T.O.F.T.U. no tags but Secret location and no calendar or share buttons.
  assert.match(showsJs, /isToftu\(s\)/);
  assert.equal((showsJs.match(/!isToftu\(s\)/g) || []).length >= 3, true);
}

// The page: cards, tags and the city pages.
assert.match(showsJs, /Just added/);
assert.match(showsJs, /Tickets on Subduction/);
assert.match(showsJs, /Nothing <em>up yet\.<\/em>/);
assert.match(showsJs, /Send in a show/);
assert.match(showsJs, /Sell tickets on Subduction/);
assert.match(showsJs, /loading="lazy"/);
assert.doesNotMatch(showsJs, /\b(few left|selling fast|almost gone|sold out soon)\b/i);
