// Locks the security fixes from issue #72 in place. The functions run on Deno and can't be imported here,
// so each check reads the source and asserts the guard is there, in the right place (before any write).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const promoter = read("supabase/functions/promoter/index.ts");
const account = read("supabase/functions/account/index.ts");
const demo = read("supabase/functions/demo/index.ts");
const waitlist = read("supabase/functions/artist-waitlist/index.ts");
const crm = read("supabase/functions/crm-sync/index.ts");
const guard = read("supabase/functions/_shared/signin_guard.ts");
const mig = read("supabase/migrations/0057_provision_once.sql");

// The code between two markers, so a check can't be satisfied by a different handler.
const between = (src, from, to) => {
  const i = src.indexOf(from); assert.ok(i >= 0, "missing: " + from);
  const j = to ? src.indexOf(to, i + from.length) : src.length; assert.ok(j > i, "missing end: " + to);
  return src.slice(i, j);
};
const before = (block, guardText, writeText) => {
  const g = block.indexOf(guardText), w = block.indexOf(writeText);
  assert.ok(g >= 0, "guard missing: " + guardText); assert.ok(w >= 0, "write missing: " + writeText);
  assert.ok(g < w, `"${guardText}" must come before "${writeText}"`);
};

// 1. Sign-in codes: 10 wrong guesses a day per person, 10 emails a day, a new code cancels older ones.
assert.match(guard, /MAX_FAILS_PER_DAY = 10/);
assert.match(guard, /MAX_CODE_EMAILS_PER_DAY = 10/);
assert.match(guard, /signin:fail/);
assert.match(guard, /Date\.now\(\) - DAY_MS/);
const verify = between(promoter, 'if (a === "login" || a === "verify")', "// ---- the one-tap link");
assert.match(verify, /guessesLocked\(m!\.id\)/);
assert.match(verify, /429/);
before(verify, "guessesLocked(m!.id)", "codeHash(m!.id, code)");
assert.match(verify, /noteGuessFail\(m!\.id\)/);
assert.match(promoter, /async function mailCode[\s\S]*codeEmailAllowed[\s\S]*sendSignin/);
assert.equal((promoter.match(/await sendSignin\(/g) || []).length, 1, "promoter must send codes only through mailCode");
const acct = between(account, 'if (b.a === "code")', 'if (b.a === "redeem")');
assert.match(acct, /countToday\(m\.id, "signin:fail"\)\) >= MAX_FAILS_PER_DAY/);
before(acct, "signin:fail", "const want");
assert.match(acct, /note\(m\.id, "signin:fail"\)/);
assert.match(account, /MAX_FAILS_PER_DAY = 10, MAX_CODE_EMAILS_PER_DAY = 10/);
const send = between(account, "async function sendSignin(email: string)", "// ---- how a show looks");
assert.match(send, /signin:sent"\)\) >= MAX_CODE_EMAILS_PER_DAY/);
before(send, 'update({ used_at: new Date().toISOString() }).eq("subscriber_id", m.id).is("used_at", null)', 'insert({ subscriber_id: m.id, code_hash');

// 2. Demo: an existing email changes nothing; claim creates nothing without the inbox key.
const start = between(demo, 'let { data: l } = await db.from("demo_leads").select("*").eq("email", email)', "Couldn't set that up");
assert.match(start, /if \(l\) return json\(\{ sent: true \}\);/);
assert.equal(/\.update\(/.test(start), false, "start must never update an existing lead");
const claim = between(demo, 'if (b.a === "claim")', 'if (b.a === "signin")');
before(claim, "const proven", 'from("companies").insert');
before(claim, "if (!proven)", 'from("company_staff").upsert');
before(claim, "if (!proven)", 'from("subscribers").insert');

// 3-5. Owner-only: kit-save, submit, street-save. Staff get 403, show locks give 409, all before any write.
const kit = between(promoter, 'if (a === "kit-save")', 'if (a === "submit")');
assert.match(kit, /canManage\(st, companyId\)\) return no\([^)]*403\)/);
before(kit, "canManage(st, companyId)", 'update({ kit })');
before(kit, "handsOffShow(", 'update({ kit })');
assert.match(kit, /review_status === "approved"\) return no\([^)]*409\)/);
const submit = between(promoter, 'if (a === "submit")', 'return no("Bad request")');
assert.match(submit, /canManage\(st, companyId\)\) return no\([^)]*403\)/);
assert.match(submit, /handsOffShow\([\s\S]*?\) return no\([^)]*409\)/);
before(submit, "canManage(st, companyId)", ".update(");
before(submit, "handsOffShow(", ".update(");
const street = between(promoter, 'if (a === "street" || a === "street-save")', 'if (a === "me")');
assert.match(street, /a === "street-save" && !canManage\(st, show\.company_id\)\) return no\([^)]*403\)/);
before(street, "canManage(", "saveStreetLink(");

// 6. crew(): buyers, guests and artist people only for the owner.
const ret = account.slice(account.indexOf("artist_people: canAdd"));
assert.match(ret, /artist_people: canAdd \?[^;]*: \[\]/);
assert.match(ret, /guests: canAdd \?/);
assert.match(ret, /buyers: canAdd \?/);

// 7. Artist waitlist: insert only.
assert.equal(/\.update\((?!\{ (crm_synced_at|alerted_at))/.test(waitlist), false, "waitlist must not update rows from the form");
assert.match(waitlist, /if \(existing\) return json\(\{ ok: true \}\)/);
before(waitlist, "if (existing)", "syncContact(fields)");

// Follow-ups: crm-sync skips unverified leads, provision reactivates only promoter-open, one company per person.
assert.match(crm, /const activeLeads/);
assert.match(crm, /activeLeads\.has\(/);
assert.match(promoter, /OPEN_SOURCE = "promoter-open"/);
assert.match(promoter, /insert\(\{ email, source: OPEN_SOURCE, status: "unsubscribed" \}\)/);
assert.match(promoter, /\.eq\("source", OPEN_SOURCE\)/);
assert.equal(/\.eq\("source", "promoter"\)/.test(promoter), false);
assert.match(promoter, /rpc\("provision_promoter_company"/);
assert.match(mig, /pg_advisory_xact_lock/);
assert.match(mig, /if exists \(select 1 from public\.company_staff where subscriber_id = p_subscriber\)/);
assert.match(mig, /grant execute[\s\S]*service_role/);

console.log("security hardening ok");
