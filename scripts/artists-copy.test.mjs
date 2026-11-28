// Artists page leads with the waitlist value, not "Coming soon" (issue #70 item 5).
// Fails if the built headline says "Coming soon", if the waitlist form or its fields go missing,
// if "coming soon" leaves as a quieter line, if the preview stops saying it isn't live, or if Bungee returns.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "dist/artists.html"), "utf8");
const fail = (m) => { console.error("artists copy test failed: " + m); process.exit(1); };

const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
if (!h1) fail("no h1 on /artists.html");
if (/coming\s+soon/i.test(h1.replace(/<[^>]+>/g, " "))) fail("headline still says Coming soon: " + h1);
if (!/<p class="soon">[^<]*coming soon[^<]*<\/p>/i.test(html)) fail("the quieter coming soon line is missing");
const hero = html.slice(html.indexOf('<section class="hero">'), html.indexOf("</section>"));
if (hero.indexOf('<p class="soon">') < hero.indexOf("<h1")) fail("coming soon must sit below the headline");

if (!/<form id="aw"/.test(html)) fail("waitlist form #aw is missing");
for (const id of ["awArtist", "awFull", "awEmail", "awPhone", "awHp", "awBtn", "awMsg", "done"]) if (!html.includes('id="' + id + '"')) fail("waitlist id missing: " + id);
if (!/src="assets\/artists\.js(\?v=[0-9a-f]+)?"/.test(html)) fail("artists.js is not loaded");
const js = readFileSync(join(root, "dist/assets/artists.js"), "utf8");
if (!/S\.api\("artist-waitlist"/.test(js)) fail("waitlist form no longer posts to artist-waitlist");

if (!/id="preview"/.test(html) || !/Not live yet/.test(html)) fail("artist page preview must be there and say it is not live");
if (/Bungee/.test(html)) fail("no Bungee on marketing pages");
const home = readFileSync(join(root, "dist/index.html"), "utf8");
if (!/class="fine artline[^"]*" id="artists">Artists: one page for your music/.test(home)) fail("homepage artist line should lead with the value");

console.log("artists copy ok: value-led headline, quieter coming soon line, waitlist form intact");
