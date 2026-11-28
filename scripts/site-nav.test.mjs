// Issue #71. One public header, footer and phone menu on the marketing pages, and none on show, ticket,
// T.O.F.T.U. or tool pages. Runs on the built dist/ (check.mjs builds first).
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
const dist = (f) => new URL("../dist/" + f, import.meta.url);
const built = (f) => readFileSync(dist(f), "utf8");
const city = readdirSync(dist("shows/")).find((d) => existsSync(dist(`shows/${d}/index.html`)) && d !== "review");
assert.ok(city, "at least one city page is built");

const WITH = ["index.html", "shows.html", "shows/index.html", `shows/${city}/index.html`, "shows-send.html", "fees.html", "artists.html", "demo.html", "privacy.html", "terms.html", "promoter.html"];
for (const f of WITH) {
  const html = built(f);
  const bar = (html.match(/<header class="sx-bar[^"]*" id="sx-bar">([\s\S]*?)<\/header>/) || [])[1];
  assert.ok(bar, f + ": shared header");
  const nav = (bar.match(/<nav class="sx-nav"[^>]*>([\s\S]*?)<\/nav>/) || [])[1] || "";
  const items = [...nav.matchAll(/<a href="([^"]+)"(?![^>]*hidden)[^>]*>([^<]+)<\/a>/g)].map((m) => m[2] + " " + m[1]);
  assert.deepEqual(items, ["Shows /shows", "Artists /artists.html", "My account /me.html"], f + ": header order");
  assert.match(bar, /<a class="sx-go" href="\/promoter\.html">Sell tickets<\/a>/, f + ": Sell tickets goes to /promoter.html");
  assert.ok(bar.indexOf('class="sx-nav"') < bar.indexOf('class="sx-go"'), f + ": Sell tickets comes after the links");
  const menu = (bar.match(/<details class="sx-menu">([\s\S]*?)<\/details>/) || [])[1] || "";
  assert.deepEqual([...menu.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]), ["Shows", "Artists", "My account", "Sell tickets"], f + ": phone menu");
  const foot = (html.match(/<footer class="sx-foot[^"]*" id="foot">([\s\S]*?)<\/footer>/) || [])[1];
  assert.ok(foot, f + ": shared footer");
  for (const g of ["Fans", "Promoters", "Artists"]) assert.ok(foot.includes(`<p class="sx-h">${g}</p>`), f + ": footer group " + g);
  assert.match(foot, /<a href="\/promoter\.html">Sell tickets<\/a><a href="\/fees\.html">Fees<\/a><a href="\/demo\.html">Try a test ticket<\/a>/, f + ": crew links");
  assert.match(foot, /<nav class="sx-legal"[^>]*><a href="\/privacy\.html">Privacy<\/a><a href="\/terms\.html">Terms<\/a><a href="[^"]+" class="contact">Contact<\/a><\/nav>/, f + ": legal row");
  assert.match(foot, /id="fsocial"/, f + ": social row kept");
  assert.doesNotMatch(foot, /instagram/i, f + ": Instagram stays out");
  assert.doesNotMatch(bar + foot, /Fee calculator|Pricing|Promoter sign in|href="\/?demo(\.html)?">Sell/, f + ": one label each in the chrome");
  assert.doesNotMatch(html, /Powered by Subduction/, f + ": no Powered by");
  assert.match(html, /assets\/chrome\.css/, f + ": chrome.css linked");
}
// Floating headers (over the hero art) turn solid black once the page scrolls.
for (const f of ["index.html", "shows.html", "artists.html", "shows-send.html"]) assert.match(built(f), /<\/header><script>[^<]*sx-solid/, f + ": floating header turns solid on scroll");
// The homepage keeps the ids its scripts need.
for (const id of ["mine", "fsocial", "foot-cat"]) assert.match(built("index.html"), new RegExp(`id="${id}"`), "homepage id " + id);
assert.doesNotMatch(built("index.html"), />Fee calculator</, "homepage says Fees");

// No shared chrome on show, ticket, T.O.F.T.U. or tool pages, or on the signed-in fan pages.
const WITHOUT = ["show.html", "404.html", "tickets.html", "ticket.html", "underground/index.html", "door.html", "admin.html", "people.html", "studio.html", "pass.html", "artist.html", "in.html", "bonus.html", "me.html", "collection.html", "t.html", "shows-review.html"];
for (const f of WITHOUT) if (existsSync(dist(f))) assert.doesNotMatch(built(f), /sx-bar|sx-foot|SITE-NAV|SITE-FOOT/, f + " must not carry the shared chrome");
// Fan pages get a way home and light hooks instead.
for (const f of ["me.html", "collection.html", "t.html"]) {
  const html = built(f);
  assert.match(html, /class="sx-home"[\s\S]*href="\/"[\s\S]*href="\/shows"/, f + ": way home and to Shows");
  assert.match(html, /href="\/artists\.html">join the waitlist/, f + ": artist hook");
  assert.match(html, /href="\/promoter\.html">Run your show on Subduction/, f + ": crew hook");
}
// Missing slug: says so and links to /shows and home. A loaded show adds nothing.
const showJs = readFileSync(new URL("../site/assets/show.js", import.meta.url), "utf8");
assert.match(showJs, /function miss\(text\) \{\n[^\n]*\n[^\n]*href="\/shows">Find a show<\/a><a class="home" href="\/">Back home<\/a>/);
assert.match(showJs, /"That show isn't here\."/);
// Directory crew hook goes to /promoter.html, plus the artist waitlist line.
assert.match(readFileSync(new URL("../site/assets/shows.js", import.meta.url), "utf8"), /Selling tickets for this\? <a href="\/promoter\.html">/);
assert.match(built("shows.html"), /href="\/artists\.html">join the waitlist/);
// The single sign-in still lands on /me.html.
for (const d of ["account", "login", "signin"]) assert.match(built(`${d}/index.html`), /location\.replace\("\/me\.html"/, d);
// Sitemap.
const map = built("sitemap.xml");
for (const u of ["https://subduction.art/shows", "https://subduction.art/fees.html"]) assert.ok(map.includes(`<loc>${u}</loc>`), "sitemap " + u);
console.log("site-nav ok");
