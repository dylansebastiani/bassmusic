// The signed-out /promoter.html start screen sells before it asks: pitch, fee line and a sample preview sit above the email form.
// Fails if the fee line or preview leaves the built start screen, or if the fee stops matching fees.js.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const fail = (m) => { console.error("promoter start test failed: " + m); process.exit(1); };

const js = readFileSync(join(dist, "assets/promoter.js"), "utf8");
const a = js.indexOf("function signin()"), b = js.indexOf("function home()", a);
if (a < 0 || b < 0) fail("signin() not found in dist/assets/promoter.js");
const s = js.slice(a, b);
const at = (needle) => { const i = s.indexOf(needle); if (i < 0) fail("start screen is missing " + needle); return i; };

const form = at("<form id=f1");
const fee = at("$1.50 flat buyer fee");
at("You keep your full ticket price.");
const pitch = at("<p class=pitch>");
const fig = at("<figure class=preview");
const img = at('src="assets/pv-page.webp"');
for (const [f, w, h] of [["pv-page", 296, 530], ["pv-ticket", 298, 432], ["pv-door", 298, 162]]) if (!new RegExp(f + '\\.webp" width="' + w + '" height="' + h + '"').test(s)) fail(f + " needs width " + w + " and height " + h);
for (const l of ["Your page", "Their ticket", "Your door"]) at("<b>" + l + "</b>");
for (const [n, i] of [["pitch", pitch], ["fee line", fee], ["preview", fig], ["preview image", img]]) if (i > form) fail(n + " must sit above the email form");
if (!/Sample show/.test(s)) fail("preview must be labeled as a sample");
// Sign-in stays the same: honeypot, Turnstile on focus, same endpoint action.
at("hp_field"); at('loadTurnstile, { once: true }'); at('a: "open"');

const webp = join(dist, "assets/pv-page.webp");
if (!existsSync(webp)) fail("dist/assets/pv-page.webp is missing");
const buf = readFileSync(webp);
if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") fail("preview is not a webp");
if (buf.length > 60000) fail("preview image is over 60KB");

const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, "site/assets/fees.js"), "utf8") + ";this.F=SubductionFees;", ctx);
if (ctx.F.feeCents(2500) !== 261) fail("feeCents(2500) should be 261");
if (ctx.F.checkoutTotal(2500, 1) !== 2761) fail("checkoutTotal(2500, 1) should be 2761");
if (!/PLATFORM = 150/.test(readFileSync(join(root, "site/assets/fees.js"), "utf8"))) fail("fees.js flat fee is no longer $1.50, update the start screen fee line");

console.log("promoter start ok: pitch, $1.50 fee line and sample preview above the form, sign-in untouched");
