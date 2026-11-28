// Sell tickets sign-in: one button into the promoter app, never a code with nowhere to type it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const fn = readFileSync(new URL("../supabase/functions/promoter/index.ts", import.meta.url), "utf8");
const js = readFileSync(new URL("../site/assets/promoter.js", import.meta.url), "utf8");
const tpl = readFileSync(new URL("../supabase/functions/_shared/templates.ts", import.meta.url), "utf8");
const open = fn.slice(fn.indexOf('if (a === "open")'), fn.indexOf('if (req.method === "GET" && a === "link")'));
assert.match(open, /await mailButton\(full/, "open sends the one-tap button");
assert.doesNotMatch(open, /mailCode\(/, "open never sends the code email");
assert.match(fn, /promoterSignin\(`\$\{SITE_URL\}\/promoter#invite=\$\{row\.id\}\.\$\{secret\}`\)/, "button opens the promoter app through redeem");
assert.match(fn, /codeEmailAllowed\(m\.id\)[\s\S]{0,400}gte\("created_at", new Date\(Date\.now\(\) - 60000\)/, "button keeps the daily cap and one a minute");
assert.match(tpl, /export function promoterSignin/, "template exists");
assert.doesNotMatch(tpl.slice(tpl.indexOf("export function promoterSignin")), /collection\.html/, "button never opens the fan collection");
assert.doesNotMatch(js, /no_crew\)[^;]*me\.html/, "no crew opens an account here, not a bounce to My account");
assert.match(fn, /a === "start" && s0 && live0 && isLimitedSession/, "a member-key session can't open a crew");
console.log("promoter-signin checks passed");
