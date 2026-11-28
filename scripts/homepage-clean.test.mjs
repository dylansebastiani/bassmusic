// Homepage bottom cleanup (handoff item 3). Fails if Bungee, the removed dead CSS or the "three doors" strip
// come back, if a signup id goes missing, or if the fee numbers change.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const css = (src.match(/<style>\n\/\* Promoters first[\s\S]*?<\/style>/) || [""])[0];
assert.ok(css.length > 1000, "homepage style block found");
assert.doesNotMatch(src, /Bungee/, "no Bungee on the homepage");
for (const sel of [".grid", ".tag", ".cmp", "table.cmp", ".perks", ".world", ".wp", ".wscrim", ".laser", ".doors", ".bar", ".foot", ".flinks", ".fcopy", ".who", ".gets", ".unit.stack"]) {
  assert.ok(!new RegExp(sel.replace(/\./g, "\\.") + "(?![\\w-])").test(css), "dead selector is back: " + sel);
}
assert.doesNotMatch(src, /class="doors"|Three doors/, "the doors strip is gone");
for (const id of ["f", "email", "btn", "hint", "hintBtn", "msg", "cf", "code", "cbtn", "resend", "other", "ts", "website", "fine", "proof", "fanH", "fans"]) {
  assert.match(src, new RegExp(`id="${id}"`), "signup id missing: " + id);
}
// #mine lives in the shared header now (scripts/chrome.mjs), and the built homepage must still have it.
assert.match(readFileSync(new URL("../dist/index.html", import.meta.url), "utf8"), /id="mine"/, "built homepage has #mine");
// ?e=, ?r= and ?src= visitors still land on the signup box.
assert.match(src, /var fanVisit = !!\(S\.q\.get\("e"\) \|\| S\.q\.get\("r"\) \|\| S\.q\.get\("src"\)\);/);
assert.match(src, /\$\("fans"\)\.scrollIntoView/);
// Fee numbers stay exactly as they were.
for (const n of ["$1.50", "$2.61", "$27.61", "$3.52", "$3.49", "$3.25"]) assert.ok(src.includes(n), "fee number " + n);
// One promoter CTA, to the promoter start page. Artists and fans share one section, signup box first.
const promo = src.slice(src.indexOf('id="promoters"'), src.indexOf('id="pricing"'));
assert.deepEqual([...promo.matchAll(/class="(?:btn|ghost)" href="([^"]+)"/g)].map((m) => m[1]), ["promoter.html"]);
assert.doesNotMatch(src, /<section[^>]+id="artists"/, "artists has no section of its own");
const fans = src.slice(src.indexOf('id="fans"'));
assert.ok(fans.indexOf('id="f"') < fans.indexOf('href="artists.html">Join the waitlist'), "signup box comes before the artist line");
// The checklist moved to /fees.html.
assert.match(readFileSync(new URL("../site/fees.html", import.meta.url), "utf8"), /Every show gets[\s\S]*Your buyer list, yours to export/);
console.log("homepage-clean ok");
