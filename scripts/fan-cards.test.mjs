// Fan show cards (site/assets/fan.js) on My account and My collection.
// Fails if the countdown says the wrong thing, if the calendar file leaks more than public facts,
// or if My account / My collection stop loading the cards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const box = { module: { exports: {} }, Intl, Date, Math, String, Number };
vm.runInNewContext(read("../site/assets/fan.js"), box);
const Fan = box.module.exports;

const at = (iso) => Date.parse(iso);
const show = (when, ends) => ({ show: "Fault Line", when, ends: ends || when, city: "Peoria, IL", nights: ["Fri Jan 8"], starts: [when], link: "https://subduction.art/fault-line", secret: true });
// Days count by the Chicago calendar, not 24-hour blocks.
assert.equal(Fan.countdown(show("2027-01-09T03:00:00Z"), at("2026-11-28T18:00:00Z")).big, "41");
assert.equal(Fan.countdown(show("2026-11-30T03:00:00Z"), at("2026-11-28T18:00:00Z")).big, "Tomorrow");
assert.match(Fan.countdown(show("2026-11-29T03:00:00Z"), at("2026-11-28T20:00:00Z")).big, /^7h 0m$/);
assert.equal(Fan.countdown(show("2026-11-29T03:00:00Z", "2026-11-29T03:00:00Z"), at("2026-11-29T05:00:00Z")).big, "On now");

const ics = Fan.ics(show("2027-01-09T03:00:00Z"));
assert.match(ics, /SUMMARY:Fault Line/);
assert.match(ics, /LOCATION:Secret location\\, Peoria\\, IL/);
assert.match(ics, /TRIGGER:-P1D/);
assert.doesNotMatch(ics, /venue|address|token/i);

for (const [page, js] of [["../site/me.html", "fan.js"], ["../site/collection.html", "fan.js"]]) {
  const html = read(page);
  assert.ok(html.includes("assets/" + js) && html.includes("assets/fan.css"), page + " loads the fan cards");
}
assert.match(read("../site/assets/me.js"), /Fan\.draw\(\$\("fanShows"\)/);
assert.match(read("../site/assets/collection.js"), /Fan\.draw\(\$\("fanTop"\)/);
// The account function only adds public show facts to the fan's tickets. Never the venue or address.
const acct = read("../supabase/functions/account/index.ts");
const fanEv = acct.match(/db\.from\("events"\)\.select\("([^"]+)"\)\.in\("id", eventIds\)/)[1];
assert.doesNotMatch(fanEv, /venue|address/);
console.log("fan cards ok");
