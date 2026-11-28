// Locks the show submit flow: one-time and expiring links, tampered tokens, link parsing,
// what the owner sees versus the public, secret-location reveal, and the page's escaping.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LINK_DAYS, SESSION_HOURS, chicagoLocalToIso, cleanHandle, expiry, flyerHints, hashToken, isToken, linkMail, linkState, newLinkMail,
  newToken, ownerView, parseAge, parseEvent, parseSounds, readShow, redeemLink, reviewExtras, sessionFor, ticketSite, UNSUB_HEADER,
  linkCapReached, mayMailLink, publicFlyerPath,
} from "../supabase/functions/directory/submit.mjs";
import { cityPath, externalCard, publicCard, secretNow } from "../supabase/functions/directory/listing.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const now = new Date("2026-11-28T12:00:00Z");
const today = "2026-11-28";

// ---------- magic links: once, 7 days, tamper-proof ----------
function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async add(kind, listing_id, at) {
      const token = newToken();
      rows.set(await hashToken(token), { id: "r" + rows.size, listing_id, kind, expires_at: expiry(kind, at).toISOString(), used_at: null });
      return token;
    },
    async find(hash) { return rows.get(hash) || null; },
    async markUsed(id, iso) {
      for (const r of rows.values()) if (r.id === id) { if (r.used_at) return false; r.used_at = iso; return true; }
      return false;
    },
  };
}
assert.equal(LINK_DAYS, 7);
assert.equal(expiry("link", now).toISOString(), "2026-12-05T12:00:00.000Z");
assert.equal(SESSION_HOURS, 2);
{
  const st = memoryStore();
  const t = await st.add("link", "L1", now);
  assert.match(t, /^[0-9a-f]{64}$/);
  // Works once.
  assert.deepEqual(await redeemLink(st, t, new Date(now.getTime() + 60000)), { ok: true, listing_id: "L1" });
  assert.deepEqual(await redeemLink(st, t, new Date(now.getTime() + 120000)), { ok: false, reason: "used" });
  // Two requests at the same moment: only one wins.
  const t2 = await st.add("link", "L2", now);
  const both = await Promise.all([redeemLink(st, t2, now), redeemLink(st, t2, now)]);
  assert.equal(both.filter((r) => r.ok).length, 1);

  // Expires after 7 days, to the second.
  const t3 = await st.add("link", "L3", now);
  assert.equal((await redeemLink(st, t3, new Date(now.getTime() + 7 * 86400000 - 1000))).ok, true);
  const t4 = await st.add("link", "L4", now);
  assert.deepEqual(await redeemLink(st, t4, new Date(now.getTime() + 7 * 86400000)), { ok: false, reason: "expired" });
  const t5 = await st.add("link", "L5", now);
  assert.deepEqual(await redeemLink(st, t5, new Date(now.getTime() + 8 * 86400000)), { ok: false, reason: "expired" });

  // Tampered: one flipped character, wrong length, wrong case, junk, empty, not a string.
  const t6 = await st.add("link", "L6", now);
  const flipped = t6.slice(0, -1) + (t6.endsWith("0") ? "1" : "0");
  for (const bad of [flipped, t6.slice(1), t6 + "0", t6.toUpperCase(), "../../etc", "' or 1=1 --", "", null, undefined, 42, { a: 1 }]) {
    assert.equal((await redeemLink(st, bad, now)).ok, false, "tampered token accepted: " + String(bad));
  }
  assert.equal((await redeemLink(st, t6, now)).ok, true, "the real token still works after the bad tries");
  // A stored hash is not a token, and a session is not a link.
  const s1 = await st.add("session", "L7", now);
  assert.equal((await redeemLink(st, s1, now)).ok, false);
  assert.equal((await redeemLink(st, await hashToken(t6), now)).ok, false);
  assert.equal(isToken(await hashToken("x")), true, "hash has token shape, so the lookup must hash again");
}
// Sessions: open for 2 hours, never used up, never a link.
{
  const st = memoryStore();
  const s = await st.add("session", "S1", now);
  assert.equal(await sessionFor(st, s, new Date(now.getTime() + 3600000)), "S1");
  assert.equal(await sessionFor(st, s, new Date(now.getTime() + 3600000)), "S1");
  assert.equal(await sessionFor(st, s, new Date(now.getTime() + 2 * 3600000)), null, "expired session");
  assert.equal(await sessionFor(st, s.slice(1), now), null, "tampered session");
  const l = await st.add("link", "S2", now);
  assert.equal(await sessionFor(st, l, now), null, "a link cannot act as a session");
  assert.equal(await sessionFor(st, undefined, now), null);
}
assert.equal(linkState(null, now), "missing");
assert.equal(linkState({ kind: "link", expires_at: "garbage" }, now), "expired");

// ---------- the function wires these in ----------
const fn = read("../supabase/functions/directory/index.ts");
assert.match(fn, /verifyTurnstile/, "Turnstile on submit");
assert.match(fn.slice(fn.indexOf('if (a !== "submit")')), /botCheck/);
assert.match(fn, /a === "link"[\s\S]*botCheck/);
assert.match(fn, /limited\(req, "link"/);
assert.match(fn, /linkCapReached\(count\)/, "per-email link cap");
assert.match(fn, /redirect: "manual"/, "page fetch re-checks every redirect");
assert.match(fn, /listing_id/);
assert.doesNotMatch(fn, /\.insert\(\{[^}]*token:/, "raw tokens are never stored");
assert.match(fn, /List-Unsubscribe/, "mail carries the unsubscribe header");
// Same answer whether or not the email exists: the link branch has one success return and it carries no row data.
const linkBranch = fn.slice(fn.indexOf('if (a === "link")'), fn.indexOf('if (a !== "submit")'));
assert.equal((linkBranch.match(/return json\(\{ ok: true \}\)/g) || []).length, 2, "honeypot and the real path both answer { ok: true }");
assert.doesNotMatch(linkBranch.replace(/\/\/.*$/gm, ""), /return json\(\{[^}]*(exists|found|sent)/i);
// Held and T.O.F.T.U. things stay untouched by this function.
assert.doesNotMatch(fn, /from\("(events|tickets|orders|ticket_nights)"\)\.(update|insert|delete)/);

// ---------- no venue, lineup or address on any public path ----------
const row = {
  status: "approved", name: "Basement Rave", show_date: "2027-03-01", venue: "Real Hall", venue_secret: true, secret_reveal_at: "2027-03-01T20:00:00Z",
  lineup: "Ace, Zed", price: "$25", artist_socials: "@ace", promoter_ig: "promo", city: "Chicago", state: "IL",
  ticket_url: "https://posh.vip/e/x", flyer_url: "https://cdn.example/f.jpg", submitter_email: "p@example.com", address: "9 Main St",
};
for (const at of ["2027-02-01T00:00:00Z", "2027-03-01T21:00:00Z"]) {
  const pub = publicCard(externalCard(row, today, new Date(at)));
  assert.doesNotMatch(JSON.stringify(pub), /Real Hall|Ace|Zed|\$25|promo|p@example|9 Main|lineup|venue|address/i, "public card leaked at " + at);
  assert.deepEqual(Object.keys(pub).sort(), ["city", "dates", "flyer", "fresh", "name", "path", "secret", "slug", "source", "state", "url", "when"]);
}
// Secret until the reveal time, then the label goes. The venue is still never on the card.
assert.equal(publicCard(externalCard(row, today, new Date("2027-02-01T00:00:00Z"))).secret, true);
assert.equal(publicCard(externalCard(row, today, new Date("2027-03-01T21:00:00Z"))).secret, false);
assert.equal(secretNow({ venue_secret: true }, now), true, "no reveal time means it stays secret");
assert.equal(secretNow({ venue_secret: false }, now), false);
// The public GET reads only columns that are safe to show.
const listSel = (fn.match(/from\("directory_listings"\)\s*\.select\("([^"]*)"\)\s*\.eq\("status", "approved"\)/) || [])[1] || "";
assert.ok(listSel.length > 0, "found the public listings select");
assert.doesNotMatch(listSel, /\b(venue|lineup|crew|address\w*|price|artist_socials|promoter_ig|submitter_email|age|sounds)\b/, "public select: " + listSel);
// The owner and Dylan do see them, behind a session or a review key.
const full = ownerView({ ...row, id: "i", lineup: "Ace", sounds: ["Dubstep"], flyer_path: "a.jpg", public_flyer_path: null, status: "pending" }, (p) => (p ? "https://f/" + p : ""), "https://subduction.art", cityPath);
assert.equal(full.venue, "Real Hall");
assert.equal(full.lineup, "Ace");
assert.equal(reviewExtras({ ...row, sounds: ["Dubstep"], age: "21" }).age, "21+");

// ---------- the promo kit stays locked until approval ----------
const pend = ownerView({ ...row, id: "i", status: "pending", flyer_path: "a.jpg" }, (p) => (p ? "https://f/" + p : ""), "https://subduction.art", cityPath);
assert.deepEqual(pend.kit, { locked: true });
assert.equal(pend.stage, "review");
assert.equal(JSON.stringify(pend.kit).includes("a.jpg"), false);
const live = ownerView({ ...row, id: "i", status: "approved", flyer_path: "a.jpg" }, (p) => (p ? "https://f/" + p : ""), "https://subduction.art", cityPath);
assert.equal(live.kit.locked, false);
assert.equal(live.kit.share_url, "https://subduction.art/shows/chicago-il");
assert.equal(live.stage, "live");
assert.equal(ownerView({ ...row, id: "i", status: "rejected" }, () => "", "https://subduction.art", cityPath).kit.locked, true);

// ---------- fields ----------
const good = { name: "Night <b>one</b>", date: "2027-03-01", city: "Chicago", state: "il", venue: "The Room", ticket_url: "https://posh.vip/e/night#frag", sounds: JSON.stringify(["Riddim", "Dubstep", "DnB", "Warehouse", "Nope"]), age: "21+", venue_secret: "1", secret_reveal: "2027-03-01T15:00", promoter_ig: "@my.page", lineup: "A, B" };
const r = readShow(good, today);
assert.ok(r.data, r.error);
assert.deepEqual(r.data.sounds, ["Riddim", "Dubstep", "DnB"], "up to 3, known sounds only");
assert.equal(r.data.age, "21");
assert.equal(r.data.state, "IL");
assert.equal(r.data.promoter_ig, "my.page");
assert.equal(r.data.secret_reveal_at, "2027-03-01T21:00:00.000Z");
assert.equal(r.data.ticket_url, "https://posh.vip/e/night");
assert.equal(r.data.name, "Night <b>one</b>", "stored as typed; every page escapes on output");
assert.equal(readShow({ ...good, state: "CA" }, today).error, "Pick a Midwest state.");
assert.equal(readShow({ ...good, date: "2020-01-01" }, today).error, "Add a date that is today or later.");
assert.match(readShow({ ...good, ticket_url: "http://x.example" }, today).error, /https/);
assert.match(readShow({ ...good, ticket_url: "javascript:alert(1)" }, today).error, /https/);
assert.match(readShow({ ...good, name: "" }, today).error, /name/);
assert.match(readShow({ ...good, venue: "" }, today).error, /venue/);
assert.match(readShow({ ...good, secret_reveal: "tomorrow" }, today).error, /reveal/);
assert.equal(readShow({ ...good, venue_secret: "", secret_reveal: "2027-03-01T15:00" }, today).data.secret_reveal_at, null);
assert.equal(readShow({ ...good, sounds: "Riddim, Halftime" }, today).data.sounds.join(), "Riddim,Halftime");
assert.deepEqual(parseSounds(["Other", "other", "Bass house"]), ["Other", "Bass house"]);
assert.equal(parseAge("All ages"), "all");
assert.equal(parseAge("16"), null);
assert.equal(cleanHandle("https://instagram.com/foo.bar/"), "foo.bar");
assert.equal(cleanHandle("<script>"), "");
assert.equal(chicagoLocalToIso("2027-07-01T20:00"), "2027-07-02T01:00:00.000Z", "summer is UTC-5");
assert.equal(chicagoLocalToIso("2027-01-01T20:00"), "2027-01-02T02:00:00.000Z", "winter is UTC-6");
assert.equal(chicagoLocalToIso("nope"), "");
assert.deepEqual(flyerHints(new Uint8Array(3)), {}, "flyer reading is off until a service is chosen");

// ---------- ticket-link parsing ----------
assert.equal(ticketSite("https://posh.vip/e/abc"), "Posh");
assert.equal(ticketSite("https://www.eventbrite.com/e/abc-123"), "Eventbrite");
assert.equal(ticketSite("https://dice.fm/event/x"), "DICE");
assert.equal(ticketSite("https://ra.co/events/1"), "RA");
for (const bad of ["http://posh.vip/e/x", "https://posh.vip.evil.example/e", "https://evilposh.vip/e", "https://127.0.0.1/", "https://localhost/x", "https://user:pw@posh.vip/e", "ftp://ra.co/x", "", "https://example.com/e"]) {
  assert.equal(ticketSite(bad), "", "fetchable: " + bad);
}
const ld = (o) => `<html><head><title>Fallback</title><script type="application/ld+json">${JSON.stringify(o)}</script></head></html>`;
const ev = parseEvent(ld({
  "@context": "https://schema.org", "@type": "MusicEvent", name: "Basement &amp; Co", startDate: "2027-03-01T21:00:00-06:00",
  location: { "@type": "Place", name: "The Room", address: { addressLocality: "Chicago", addressRegion: "Illinois" } },
  performer: [{ name: "Ace" }, { name: "Zed" }], offers: [{ lowPrice: "20", priceCurrency: "USD" }], image: ["https://cdn.example/f.jpg"],
}), "https://posh.vip/e/x");
assert.deepEqual(ev.fields, { name: "Basement & Co", date: "2027-03-01", venue: "The Room", city: "Chicago", state: "IL", lineup: "Ace, Zed", price: "From $20", flyer_url: "https://cdn.example/f.jpg" });
assert.equal(ev.from.venue, "Posh page");
const graph = parseEvent(ld({ "@graph": [{ "@type": "WebSite" }, { "@type": ["Event"], name: "G", startDate: "2027-04-02" }] }), "https://dice.fm/e");
assert.equal(graph.fields.name, "G");
assert.equal(graph.from.name, "DICE page");
const og = parseEvent('<meta property="og:title" content="Night &quot;One&quot;"><meta content="https://cdn.example/o.jpg" property="og:image">', "https://ra.co/events/1");
assert.equal(og.fields.name, 'Night "One"');
assert.equal(og.fields.flyer_url, "https://cdn.example/o.jpg");
// Parsing never throws and never errors out. A bad page is just empty.
for (const junk of ["", null, undefined, "<html>", '<script type="application/ld+json">{bad</script>', "\u0000\u0001", "<meta".repeat(5000)]) {
  assert.deepEqual(Object.keys(parseEvent(junk, "https://posh.vip/e/x").fields).filter((k) => k !== "name"), []);
}
assert.equal(parseEvent(ld({ "@type": "Event", name: "x", image: "javascript:alert(1)" }), "https://posh.vip/e").fields.flyer_url, undefined);

// ---------- email ----------
const m = linkMail({ name: "Night", url: "https://subduction.art/shows-send?k=" + "a".repeat(64) });
assert.match(m.text, /stops working after 7 days/);
assert.match(m.text, /reply with the word stop/);
assert.equal(UNSUB_HEADER.startsWith("<mailto:"), true);
assert.equal(m.fromName, "Subduction");
assert.doesNotMatch(m.text + newLinkMail({ shows: [{ name: "N", token: "t" }], base: "https://subduction.art/shows-send" }).text, /—|–/);
assert.match(fn, /mailing_address/);
assert.doesNotMatch(m.text, /@/, "no email address in the link mail");

// ---------- the page ----------
const page = read("../site/shows-send.html");
const js = read("../site/assets/shows-send.js");
const css = read("../site/assets/shows-send.css");
for (const n of [1, 2, 3, 4, 5]) assert.ok(page.includes(`data-n="${n}"`), "step " + n);
assert.match(page, /name="robots" content="noindex"|name="robots" content="noindex"/);
assert.match(page, /name="referrer" content="no-referrer"/);
assert.equal((page.match(/Helps us promote the show/g) || []).length >= 5, true);
assert.match(page, /Send my link/);
assert.match(page, /Looks right/);
assert.match(page, /Send another show/);
assert.match(page, /Edit my show/);
assert.match(js, /action: "signup"/, "Turnstile action matches the server check");
assert.match(js, /history\.replaceState/, "link token leaves the address bar");
assert.doesNotMatch(js, /localStorage/, "edit session stays in the tab");
// Nothing a person types reaches innerHTML unescaped.
for (const m2 of js.matchAll(/innerHTML\s*=\s*([^;]+);/g)) {
  const expr = m2[1];
  const dynamic = expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "").replace(/esc\([^)]*\)/g, "");
  assert.doesNotMatch(dynamic, /\.(name|venue|city|state|lineup|ticket_url|artist_socials|promoter_ig|email|price|message)\b/, "unescaped value in innerHTML: " + expr);
}
assert.doesNotMatch(css, /@import/);
// Page weight budget.
assert.ok(Buffer.byteLength(page) < 150 * 1024);
// The old inline form is gone, and the directory page links to the new one.
const shows = read("../site/shows.html");
assert.match(shows, /href="\/shows-send"/);
assert.doesNotMatch(shows, /<form id="form"/);
const build = read("./build.mjs");
assert.match(build, /\/shows-send \/shows-send\.html 200/);

// ---------- debug review fixes ----------
{
  // 1. Edit-link mail only to a known non-artist address, capped per email, no show name in the subject.
  assert.equal(mayMailLink(false), true);
  assert.equal(mayMailLink(true), false, "artist address gets no link mail");
  assert.equal(mayMailLink(null), false, "failed lookup sends nothing");
  assert.equal(linkCapReached(5), false);
  assert.equal(linkCapReached(6), true);
  assert.equal(linkMail({ name: "Secret Warehouse Night", url: "https://subduction.art/shows-send?k=x" }).subject.includes("Secret"), false);
  const submitBranch = fn.slice(fn.indexOf("// Artist check first"));
  assert.ok(submitBranch.indexOf("artistContact(addr)") < submitBranch.indexOf("sendMail(linkMail"), "artist check runs before the link mail");
  assert.match(submitBranch, /mayMailLink\(flags\.get\(email\)[^)]*\)\s*&&\s*!\(await linkCapHit\(email\)\)/);
  assert.match(linkBranch, /mayMailLink\(await artistContact\(email\)\)/);
  assert.match(linkBranch, /linkCapHit\(email\)/);

  // 2. Turnstile on edit, server and page.
  const editBranch = fn.slice(fn.indexOf('if (a === "mine" || a === "edit")'), fn.indexOf('if (a === "link")'));
  assert.ok(editBranch.indexOf("botCheck(req, fields)") > editBranch.indexOf('if (a === "mine") return'), "mine stays free of the bot check");
  assert.ok(editBranch.indexOf("botCheck(req, fields)") < editBranch.indexOf("readShow(fields"), "bot check runs before any write");
  const saveFn = js.slice(js.indexOf("function save()"), js.indexOf('$("another")'));
  assert.match(saveFn, /tsPass\(8000\)[\s\S]*tsUse\(fd\)[\s\S]*call\(fd\)/);

  // 4. Impersonation.
  const base = { name: "Bass Night", date: "2027-03-01", venue: "Hall", city: "Chicago", state: "IL", ticket_url: "https://posh.vip/e/x" };
  assert.ok(readShow(base, today).data);
  for (const n of ["T.O.F.T.U. Afterparty", "tOfTu night", "Underground Rave", "The UNDERGROUND", "T O F T U", "t-o-f-t-u", "Under ground", "ＴＯＦＴＵ"]) assert.ok(readShow({ ...base, name: n }, today).error, n);
  assert.ok(readShow({ ...base, ticket_url: "https://subduction.art./x" }, today).error, "trailing-dot host");
  assert.match(fn, /split\("\+"\)\[0\]/, "plus tag is stripped before the artist lookup");
  for (const u of ["https://subduction.art/tickets/x", "https://www.subduction.art/e/y", "https://tickets.subduction.art/z"]) assert.ok(readShow({ ...base, ticket_url: u }, today).error, u);
  assert.ok(readShow({ ...base, ticket_url: "https://notsubduction.art/x" }, today).data, "look-alike host is a normal link");

  // 5. Approve race.
  const decideFn = fn.slice(fn.indexOf("async function decide"), fn.indexOf("Deno.serve"));
  assert.match(decideFn, /\.eq\("updated_at", seen\)/);
  assert.match(decideFn, /status === "approved" && !seen/);
  assert.match(decideFn, /409/);
  assert.equal((fn.match(/decide\(row, status, cleanText\(fields\.updated_at, 64\)\)/g) || []).length, 2);
  assert.match(fn, /REVIEW_COLS = "[^"]*updated_at"/);
  const rv = read("../site/assets/shows-review.js");
  assert.match(rv, /body\.updated_at = /);
  assert.match(rv, /data-v=/);

  // 6. Secret location never borrows the main flyer.
  assert.equal(publicFlyerPath({ venue_secret: true, flyer_path: "main.jpg", public_flyer_path: "" }), "");
  assert.equal(publicFlyerPath({ venue_secret: true, flyer_path: "main.jpg", public_flyer_path: "pub.jpg" }), "pub.jpg");
  assert.equal(publicFlyerPath({ venue_secret: false, flyer_path: "main.jpg", public_flyer_path: "" }), "main.jpg");
  assert.equal(publicFlyerPath({ venue_secret: false, flyer_path: "main.jpg", public_flyer_path: "pub.jpg" }), "pub.jpg");
  assert.match(fn, /flyerUrl\(publicFlyerPath\(row\)\)/);
  assert.match(page, /secret-location show needs its own public flyer|separate public flyer/);
}

// ---------- hands off ----------
for (const f of ["../site/tickets.html", "../site/ticket.html", "../site/assets/tickets.js", "../site/assets/ticket.js"]) {
  assert.doesNotMatch(read(f), /shows-send|directory_links/);
}
console.log("submit checks passed");
