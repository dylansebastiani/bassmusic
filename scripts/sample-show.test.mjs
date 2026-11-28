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
for (const [n, s] of [["demo.html", demo], ["demo.js", read("dist/assets/demo.js")], ["demo.css", read("site/assets/demo.css")]]) {
  if (/toftu|t\.o\.f\.t\.u|hangovers|\/underground\b|63b511f3/i.test(s)) fail(n + " references T.O.F.T.U.");
}
if (!/class="stag">Sample show</.test(demo)) fail("/demo.html sample show must be labeled as a sample");
if (!/src="assets\/sample-flyer\.webp" width="640" height="480"/.test(demo)) fail("/demo.html sample flyer needs the webp with width and height");
if (/id="burst"/.test(demo)) fail("the old light-burst placeholder is back on /demo.html");

const demoFn = read("supabase/functions/demo/index.ts");
if (/Demo Night/.test(demoFn)) fail("the test ticket email still says Demo Night, it should match the page");

const home = read("dist/index.html");
const promo = home.slice(home.indexOf('id="promoters"'), home.indexOf('id="pricing"'));
if (!/<figure class="art sample" id="sample"><img src="assets\/promoter-preview\.webp" width="960" height="560" alt="Sample show[^"]*" loading="lazy"/.test(promo)) fail("homepage promoters block needs the lazy sample preview with width and height");
if (!/<figcaption>Sample show\./.test(promo)) fail("homepage preview must be labeled as a sample");
if (!/\$2\.61/.test(home)) fail("homepage lost the $2.61 buyer fee");

for (const f of ["sample-flyer.webp", "promoter-preview.webp"]) {
  const b = readFileSync(join(root, "dist/assets", f));
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") fail(f + " is not a webp");
  if (b.length > 60000) fail(f + " is over 60KB");
}
console.log("sample show ok: labeled sample on /demo.html and the homepage, no placeholder, no T.O.F.T.U. assets");
