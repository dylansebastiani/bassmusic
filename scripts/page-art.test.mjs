// Page art on the pages that had none: /fees, /shows empty states, /collection, /me, /privacy, /terms.
// Fails if an image loses width/height, a file goes missing or over 45KB, the color split changes
// (laser art on fan pages, green on promoter and legal pages), or any of it touches T.O.F.T.U.
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const fail = (m) => { console.error("page art test failed: " + m); process.exit(1); };

const PAGES = [
  ["site/fees.html", "fees-wave.webp", 960, 300],
  ["site/privacy.html", "legal-rings.webp", 960, 160],
  ["site/terms.html", "legal-rings.webp", 960, 160],
  ["site/collection.html", "fans-burst.webp", 960, 400],
  ["site/me.html", "fans-burst.webp", 960, 400],
  ["site/assets/shows.js", "fans-burst.webp", 960, 400],
];
for (const [page, file, w, h] of PAGES) {
  const s = read(page);
  const tag = (s.match(new RegExp('<img class="art" src="/?assets/art/' + file.replace(".", "\\.") + '"[^>]*>')) || [])[0];
  if (!tag) fail(page + " lost its " + file + " art");
  if (!tag.includes(`width="${w}" height="${h}"`)) fail(page + " art needs width and height");
  if (!/alt=""/.test(tag)) fail(page + " art is decoration and should have empty alt");
  const kb = statSync(join(root, "site/assets/art", file)).size / 1024;
  if (kb > 45) fail(file + " is " + kb.toFixed(0) + "KB, keep it under 45KB");
}
if (!/loading="lazy"/.test(read("site/assets/shows.js").match(/<div class="quiet">[^']*/)[0])) fail("/shows empty-state art should lazy-load");

const art = read("scripts/art.mjs");
for (const [name, pal] of [["fees-wave", "brand"], ["legal-rings", "brand"], ["fans-burst", "laser"]]) {
  if (!new RegExp('\\["' + name + '",[^\\]]*pal: "' + pal + '"').test(art)) fail(name + " should use the " + pal + " palette");
}
// The generator and the art must stay Subduction's own (some pages above mention T.O.F.T.U. for other reasons).
if (/toftu|t\.o\.f\.t\.u|hangovers|63b511f3|underground|Bungee/i.test(art)) fail("scripts/art.mjs references T.O.F.T.U. or Bungee");
console.log("page art checks passed");
