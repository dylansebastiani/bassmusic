// Sample show on /demo.html and the homepage promoters block (issue #70 items 1 and 4).
// Fails if /demo.html still has the generic "Demo Night / Your venue / Your city" placeholder,
// references any T.O.F.T.U. asset, loses its "Sample show" label, or if the homepage loses the page, ticket and door preview.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const fail = (m) => { console.error("sample show test failed: " + m); process.exit(1); };

const demo = read("dist/demo.html");
for (const t of ["Demo Night", "Your venue", "Your city"]) if (demo.includes(t)) fail("/demo.html still has the placeholder " + JSON.stringify(t));
for (const [n, s] of [["demo.html", demo], ["demo.js", read("dist/assets/demo.js")], ["demo.css", read("site/assets/demo.css")], ["demo/index.ts", read("supabase/functions/demo/index.ts")]]) {
  if (/toftu|t\.o\.f\.t\.u|hangovers|\/underground\b|63b511f3/i.test(s)) fail(n + " references T.O.F.T.U.");
}
if (!/class="stag">Sample show</.test(demo)) fail("/demo.html sample show must be labeled as a sample");
// Every step that shows the sample show name carries the tag: the show page (1), the email (2) and the ticket (3).
for (const n of [1, 2, 3]) {
  const sec = demo.slice(demo.indexOf('id="s' + n + '"'), demo.indexOf("</section>", demo.indexOf('id="s' + n + '"')));
  if (!sec.includes("Fault Line")) fail("step " + n + " no longer shows the sample show");
  if (!/class="stag(?: in)?">Sample show</.test(sec)) fail("step " + n + " shows Fault Line with no Sample show tag");
}
if (!/<div class="sflyer"><div class="burst" id="burst"><\/div>/.test(demo)) fail("/demo.html sample show lost its light-burst art");
const djs = read("site/assets/demo.js");
if (!/stroke="#00e5ff"/.test(djs) || !/stroke="#ff2bd6"/.test(djs)) fail("the sample show light-burst should be neon cyan and pink");

const demoFn = read("supabase/functions/demo/index.ts");
if (/Demo Night/.test(demoFn)) fail("the test ticket email still says Demo Night, it should match the page");
if (!/const subject = "Test ticket: Fault Line";/.test(demoFn)) fail("the test ticket email subject should say Test ticket: Fault Line");

const home = read("dist/index.html");
const promo = home.slice(home.indexOf('id="promoters"'), home.indexOf('id="pricing"'));
if (!/<figure class="art sample" id="sample">/.test(promo)) fail("homepage promoters block needs the sample preview");
for (const [f, w, h, label] of [["pv-page", 296, 530, "Your page"], ["pv-ticket", 298, 432, "Their ticket"], ["pv-door", 298, 162, "Your door"]]) {
  if (!new RegExp(`<img src="assets/${f}\\.webp" width="${w}" height="${h}" alt="[^"]+" loading="lazy"`).test(promo)) fail(`homepage preview needs the lazy ${f} image with width and height`);
  if (!promo.includes(`<b>${label}</b>`)) fail("homepage preview step is missing its label " + label);
}
if (!/<figcaption>Sample show\./.test(promo)) fail("homepage preview must be labeled as a sample");
if (!/\$2\.61/.test(home)) fail("homepage lost the $2.61 buyer fee");

for (const f of ["promoter-preview.webp", "pv-page.webp", "pv-ticket.webp", "pv-door.webp"]) {
  const b = readFileSync(join(root, "dist/assets", f));
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") fail(f + " is not a webp");
  if (b.length > 60000) fail(f + " is over 60KB");
}
console.log("sample show ok: labeled sample on /demo.html and the homepage, no placeholder, no T.O.F.T.U. assets");
