// Locks the directory rules: pending stays off the list, T.O.F.T.U. is only a link,
// the honeypot matches the promoter form, and the submitter is never a recipient.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  alertRecipients, canReplyTo, chicagoYmd, cityPath, dateOk, externalCard, honeypotFilled,
  leadMail, matches, normTicketUrl, publicCard, splitPlace, subductionCard, ticketLink,
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
assert.equal(card.venue, "");
assert.equal(card.city, "Peoria");
assert.equal(card.state, "IL");
assert.deepEqual(card.dates, ["2027-01-08", "2027-01-09"]);
assert.equal(card.when, "Fri Jan 8 + Sat Jan 9");
assert.equal(card.flyer, "/assets/toftu/poster-fri.webp");
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

const src = readFileSync(new URL("../supabase/functions/directory/index.ts", import.meta.url), "utf8");
const rules = readFileSync(new URL("../supabase/functions/directory/listing.mjs", import.meta.url), "utf8");
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
