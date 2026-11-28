// Real mailing address, Instagram off (handoff item 9).
// Fails if "TBD" comes back in either stack.json, in the built privacy and terms pages, or in the footer code and
// fallbacks of the functions this change edits, if the two stack.json files drift apart, or if Instagram is turned back on.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const fail = (m) => { console.error("address test failed: " + m); process.exit(1); };
const ADDRESS = "802 South Morris Avenue, Bloomington, IL 61701";
// A /TBD/i literal is a hide-filter (it removes a placeholder), not a placeholder. Strip those before looking for "TBD".
const noFilters = (s) => s.replace(/\/TBD\/i/g, "");

const cfgText = read("config/stack.json"), sharedText = read("supabase/functions/_shared/stack.json");
if (cfgText !== sharedText) fail("config/stack.json and supabase/functions/_shared/stack.json differ, run node scripts/sync-config.mjs");
if (/TBD/i.test(cfgText)) fail("stack.json still has TBD");
const cfg = JSON.parse(cfgText);
if (cfg.mailingAddress !== ADDRESS) fail("mailingAddress should be " + ADDRESS);
if (cfg.social?.instagram !== "") fail("social.instagram should be empty for now");

for (const page of ["privacy.html", "terms.html"]) {
  const html = read("dist/" + page);
  const stack = JSON.parse((html.match(/window\.STACK=(\{.*?\});<\/script>/) || [])[1] || "null");
  if (!stack || stack.mailingAddress !== ADDRESS) fail(page + " does not get the real address in window.STACK");
  if (!/class="addr"/.test(html)) fail(page + " lost its address line");
  // The page's own hide-filter (/TBD/i, removes the line if the value is a placeholder) is allowed.
  if (/TBD/i.test(noFilters(html))) fail(page + " still says TBD");
}

// Edited functions: settings row only when it is a real address, otherwise the config value.
const fns = ["directory", "promoter", "account", "artist-sales", "demo"];
for (const f of fns) {
  const src = read(`supabase/functions/${f}/index.ts`);
  if (/TBD/i.test(noFilters(src))) fail(f + " still has a TBD placeholder");
  if (!/import \{[^}]*\bCONFIG\b[^}]*\} from "\.\.\/_shared\/config\.ts"/.test(src)) fail(f + " must read CONFIG from _shared/config.ts");
  if (/setting\("mailing_address", "[^"]+"/.test(src)) fail(f + " has a hard-coded mailing_address fallback");
  if ((src.match(/setting\("mailing_address"/g) || []).length !== 1) fail(f + " should read mailing_address only inside mailingAddress()");
  if (!/await mailingAddress\(\)/.test(src)) fail(f + " footer does not use mailingAddress()");
  const helper = (src.match(/async function mailingAddress\(\): Promise<string> \{\n([\s\S]*?)\n\}/) || [])[1];
  if (!helper) fail(f + " has no mailingAddress() helper");
  // Run the helper with a stubbed settings row.
  const run = new Function("setting", "CONFIG", "return (async () => {\n" + helper + "\n})();");
  for (const [row, want] of [[null, ADDRESS], ["", ADDRESS], ["PO Box TBD, Bloomington, IL 61701", ADDRESS], [" 1 Other Street, Peoria, IL 61602 ", "1 Other Street, Peoria, IL 61602"]]) {
    const got = await run(async (k, fb) => (k === "mailing_address" ? (row ?? fb) : fb), cfg);
    if (got !== want) fail(`${f} mailingAddress() with row ${JSON.stringify(row)} gave ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  }
}

// Allow-list (not editable in this change, listed as follow-ups):
// - the /TBD/i hide-filters in _shared (templates.ts, crowd.ts, ticket_email.ts) are filters, not placeholders.
// - checkout/index.ts (T.O.F.T.U. checkout) and reveal/index.ts (location-reveal cron) still fall back to "PO Box TBD".
for (const f of ["checkout", "reveal"]) if (!/PO Box TBD/.test(read(`supabase/functions/${f}/index.ts`))) console.log(`note: ${f} no longer has the PO Box TBD fallback, drop it from the allow-list`);

if (/PO Box TBD/.test(read("docs/HANDOFF.md").split("\n").find((l) => /Mailing address/.test(l)) || "")) fail("docs/HANDOFF.md still calls the address a placeholder");
console.log("address ok: " + ADDRESS + " in config, privacy, terms and 5 function footers, Instagram off");
