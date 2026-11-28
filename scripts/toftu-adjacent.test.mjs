// Locks the four T.O.F.T.U.-adjacent fixes from issue #72: public link list, address hold, trusted IP, Turnstile.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { publicRefs, UNDERGROUND_EVENT_ID } from "../supabase/functions/artist-sales/refs.mjs";
import { ipFromHeaders, sameSecret } from "../supabase/functions/_shared/client_ip.mjs";
import { addressHeld } from "../supabase/functions/checkout/reveal.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

// 1. Public ref list: only approved, non-hands-off shows, no secret acts.
const events = {
  ok: { id: "ok", slug: "bass-night", review_status: "approved", company_id: "c1" },
  draft: { id: "draft", slug: "later", review_status: "submitted", company_id: "c1" },
  toftu: { id: UNDERGROUND_EVENT_ID, slug: "underground", review_status: "approved", company_id: "c0" },
  legacy: { id: "legacy", slug: "old", review_status: "approved", company_id: "c0" },
  quantum: { id: "q", slug: "qshow", review_status: "approved", company_id: "cq" },
};
const companies = { c1: { slug: "crew", legacy_stripe: false }, c0: { slug: "original", legacy_stripe: true }, cq: { slug: "quantum", legacy_stripe: false } };
const refs = publicRefs({
  invites: [
    { sell_ref: "djone", name: "DJ One", event_id: "ok" }, { sell_ref: "secretact", name: "Secret Act", event_id: "ok" },
    { sell_ref: "unapproved", name: "X", event_id: "draft" }, { sell_ref: "toftuartist", name: "Y", event_id: UNDERGROUND_EVENT_ID },
    { sell_ref: "legacyartist", name: "Z", event_id: "legacy" }, { sell_ref: "qartist", name: "Q", event_id: "q" }, { sell_ref: "nowhere", name: "N", event_id: "gone" },
  ],
  links: [{ tag: "flyer1", event_id: "ok" }, { tag: "flyer2", event_id: "draft" }, { tag: "flyer3", event_id: UNDERGROUND_EVENT_ID }],
  events, companies, secretActs: { ok: ["secret act"] },
});
assert.deepEqual(refs, ["djone", "flyer1"]);
const sales = read("supabase/functions/artist-sales/index.ts");
assert.match(sales, /x-build-key/);
assert.match(sales, /BUILD_REFS_KEY/);
assert.match(read("scripts/build.mjs"), /x-build-key/);

// 2. Address hold until address_reveal_at.
const now = Date.parse("2027-01-01T00:00:00Z"), past = "2026-12-01T00:00:00Z", future = "2027-02-01T00:00:00Z";
assert.equal(addressHeld({ location_secret: true, address_reveal_at: future }, now), true);
assert.equal(addressHeld({ location_secret: true, address_reveal_at: past }, now), false);   // after reveal: shown as today
assert.equal(addressHeld({ location_secret: true, address_reveal_at: null }, now), true);
assert.equal(addressHeld({ location_secret: false, address_reveal_at: future }, now), true);  // the fix
assert.equal(addressHeld({ location_secret: false, address_reveal_at: null }, now), false);   // normal show: unchanged
assert.match(read("supabase/functions/checkout/index.ts"), /const held = addressHeld\(ev\);\n\s+const address = held \? null : ev\.address;/);

// 3. Client IP: cf-connecting-ip, else the LAST x-forwarded-for hop, else x-real-ip. Never one shared bucket.
const hdr = (o) => (k) => o[k] ?? null;
assert.equal(ipFromHeaders(hdr({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9", "x-real-ip": "8.8.8.8" })), "1.1.1.1");
assert.equal(ipFromHeaders(hdr({ "cf-connecting-ip": " 1.1.1.1 , 2.2.2.2" })), "1.1.1.1");
assert.equal(ipFromHeaders(hdr({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 3.3.3.3", "x-real-ip": "8.8.8.8" })), "3.3.3.3");
assert.equal(ipFromHeaders(hdr({ "x-forwarded-for": "4.4.4.4" })), "4.4.4.4");
assert.equal(ipFromHeaders(hdr({ "x-real-ip": "5.5.5.5" })), "5.5.5.5");
assert.notEqual(ipFromHeaders(hdr({ "x-real-ip": "5.5.5.5" })), ipFromHeaders(hdr({ "x-real-ip": "5.5.5.6" })));
assert.equal(ipFromHeaders(hdr({})), "unknown");
const dir = new URL("../supabase/functions/", import.meta.url);
for (const d of readdirSync(dir)) {
  if (!statSync(new URL(d, dir)).isDirectory()) continue;
  for (const f of readdirSync(new URL(d + "/", dir)).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(new URL(d + "/" + f, dir), "utf8");
    assert.equal(src.includes('"0.0.0.0"'), false, `${d}/${f} still falls back to 0.0.0.0`);
    assert.equal(src.includes('"no-ip"'), false, `${d}/${f} still uses one shared no-ip bucket`);
  }
}
assert.match(read("supabase/functions/_shared/util.ts"), /ipFromHeaders/);

// 3b. The refs key is compared in constant time.
assert.equal(sameSecret("abc123", "abc123"), true);
assert.equal(sameSecret("abc123", "abc124"), false);
assert.equal(sameSecret("abc123", "abc12"), false);
assert.equal(sameSecret("abc123", ""), false);
assert.match(sales, /sameSecret\(key, sent\)/);

// 3c. In CI the build refuses to run without the refs key or with an empty list.
const build = read("scripts/build.mjs");
assert.match(build, /process\.env\.CI && !process\.env\.BUILD_REFS_KEY\) throw/);
assert.match(build, /process\.env\.CI && !refs\.length\) throw/);

// 4. Turnstile fails closed with no secret, and says so in the log.
const util = read("supabase/functions/_shared/util.ts");
assert.match(util, /if \(!secret\) \{ console\.error\([^;]*TURNSTILE_SECRET[^;]*; return false; \}/);
const acct = read("supabase/functions/account/index.ts");
assert.match(acct, /if \(!secret\) \{ console\.error\([^;]*TURNSTILE_SECRET[^;]*; return false; \}/);

console.log("toftu-adjacent checks passed");
