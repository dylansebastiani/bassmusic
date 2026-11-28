// Member-key sessions are limited: they must never act as staff or start a promoter crew.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLimitedSession } from "../supabase/functions/_shared/session_trust.mjs";

const at = (ms) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();
const DAY = 86400000;
assert.equal(isLimitedSession(at(0), at(DAY)), true, "24 hour member-key session is limited");
assert.equal(isLimitedSession(at(0), at(30 * DAY)), false, "30 day email sign-in is not limited");
assert.equal(isLimitedSession(null, at(30 * DAY)), true, "unknown start fails closed");
assert.equal(isLimitedSession(at(0), undefined), true, "unknown end fails closed");

const read = (p) => readFileSync(new URL("../supabase/functions/" + p, import.meta.url), "utf8");
const company = read("_shared/company.ts");
assert.match(company, /isLimitedSession\(s\.created_at, s\.expires_at\)\) return null/, "staffAuth refuses limited sessions");
assert.match(company, /select\("subscriber_id,expires_at,created_at"\)/, "staffAuth reads created_at");
const promoter = read("promoter/index.ts");
assert.match(promoter, /!isLimitedSession\(s0\.created_at, s0\.expires_at\)/, "promoter skips provision for limited sessions");
// account/index.ts is self-contained, so its rule is inline. It must match the shared one and mint 24 hour member-key sessions.
const account = read("account/index.ts");
assert.match(account, /<= 2 \* 86400000/, "account marks sessions of 2 days or less as limited");
assert.match(account, /Date\.now\(\) \+ 86400000\)\.toISOString\(\) \}\);\s*\n\s*return json\(\{ token, email: m\.email, limited: true/, "member action mints 24 hour sessions");
console.log("session-trust ok");
