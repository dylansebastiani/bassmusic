// City show alerts: directory/alerts.mjs helpers, the directory function wiring, the migration and the page box.
// Fails if an alert email could go out without its unsubscribe link, headers or mailing address, if the copy breaks
// the house rules, if a forged city name gets through, or if the tables lose RLS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { alertMail, welcomeMail, cityFrom, showKey, unsubHeaders } from "../supabase/functions/directory/alerts.mjs";
import { cityPath } from "../supabase/functions/directory/listing.mjs";
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

// City checks: the name has to match the path, so nobody can put their own words in an email.
assert.deepEqual(cityFrom("chicago-il", "Chicago, IL", cityPath), { path: "chicago-il", name: "Chicago, IL", city: "Chicago" });
assert.equal(cityFrom("chicago-il", "Click here, IL", cityPath), null);
assert.equal(cityFrom("review", "Review, IL", cityPath), null);
assert.equal(cityFrom("../x", "Chicago, IL", cityPath), null);

// Same show, same key. Different date, different key.
const card = { source: "listing", name: "Fault Line", url: "https://posh.vip/e/fault", dates: ["2027-02-06"], path: "chicago-il", city: "Chicago", state: "IL", when: "Sat Feb 6", secret: true };
assert.equal(showKey(card), showKey({ ...card }));
assert.notEqual(showKey(card), showKey({ ...card, dates: ["2027-02-07"] }));
assert.equal(showKey({ ...card, path: "" }), "");

const site = "https://subduction.art", unsub = site + "/shows?unalert=" + "a".repeat(64), address = "802 South Morris Avenue, Bloomington, IL 61701";
const mails = [
  alertMail({ cityName: "Chicago, IL", cityPath: "chicago-il", shows: [card], unsubUrl: unsub, address, site }),
  alertMail({ cityName: "Chicago, IL", cityPath: "chicago-il", shows: [card, { ...card, name: "Sub Rings", url: "/sub-rings" }], unsubUrl: unsub, address, site }),
  welcomeMail({ cityName: "Chicago, IL", cityPath: "chicago-il", unsubUrl: unsub, address, site }),
];
for (const m of mails) {
  for (const part of [m.html, m.text]) {
    assert.ok(part.includes(unsub), "visible unsubscribe link");
    assert.ok(part.includes(address), "mailing address");
    assert.ok(!/@/.test(part.replace(/hello@subduction\.art/g, "")), "no email addresses in the body or links");
  }
  const words = m.text.replace(/https?:\/\/\S+/g, "");
  assert.doesNotMatch(words + m.subject, /—|;|\?/, "no em dashes, semicolons or questions: " + m.subject);
}
assert.match(mails[0].subject, /^New show in Chicago: Fault Line$/);
assert.match(mails[1].subject, /^2 new shows in Chicago$/);
assert.ok(mails[1].text.includes("https://subduction.art/sub-rings"), "relative show links become full links");
assert.ok(mails[0].text.includes("Secret location"), "secret shows say so and never a venue");
const h = unsubHeaders("https://x.supabase.co/functions/v1/directory?a=unalert&k=" + "b".repeat(64));
assert.match(h["List-Unsubscribe"], /^<https:\/\/.+>, <mailto:hello@subduction\.art\?subject=stop>$/);
assert.equal(h["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");

// The function: Turnstile and a rate limit on sign-up, one-click unsubscribe before the body is read, sweep after GET.
const fn = read("../supabase/functions/directory/index.ts");
const alertBlock = fn.slice(fn.indexOf('if (a === "alert")'), fn.indexOf('if (a === "approve"'));
assert.ok(/limited\(req, "alert", 6\)/.test(alertBlock) && /botCheck\(req, fields\)/.test(alertBlock), "sign-up is rate limited and bot checked");
assert.ok(/ip_hash: await ipHash\(req\)/.test(alertBlock) && !/clientIp\(req\)\s*}/.test(alertBlock), "only a hashed IP is stored");
assert.ok(fn.indexOf('url.searchParams.get("a") === "unalert"') < fn.indexOf("const ctype"), "one-click unsubscribe works on a form POST");
assert.ok(/sweepAlerts\(shows\)/.test(fn) && /baseline/.test(fn), "GET sweeps, first sweep is baseline only");

// The tables: RLS on, no policies, nothing for the browser key.
const sql = read("../supabase/migrations/0060_show_alerts.sql");
for (const t of ["show_alerts", "show_alert_shows"]) {
  assert.ok(sql.includes(`alter table public.${t} enable row level security`), t + " has RLS");
  assert.ok(sql.includes(`revoke all on table public.${t} from anon, authenticated, public`), t + " is closed to the browser");
}
assert.doesNotMatch(sql, /create policy/i);
assert.doesNotMatch(sql, /\bip\b(?!_hash)/i);

// The page box loads on /shows and every city page.
const page = read("../site/shows.html");
assert.ok(page.includes('id="alerts"') && page.includes("/assets/alerts.js") && page.includes("/assets/alerts.css"));
assert.doesNotMatch(read("../site/assets/alerts.js"), /[?&]email=/, "no email in a URL");
console.log("show alerts ok");
