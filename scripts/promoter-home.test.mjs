// Issue #93. Promoters never see a person's name, and the signed-in promoter home stays finished.
// Fails if "Dylan" or "Sebastiani" comes back into the show-sent email (text or HTML), or if the
// summary card, grouped sections, payouts card or sign-in lines go missing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// 1. The show-sent confirmation email to the promoter, minus comments.
const fn = read("../supabase/functions/promoter/index.ts");
const a = fn.indexOf("async function tellShowSent"), b = fn.indexOf("\n}\n", a);
assert.ok(a > 0 && b > a, "tellShowSent found");
// Only the promoter's half: after the staff alert, from the email check to the end of the function.
const c = fn.indexOf("if (!EMAIL_RE.test(who)) return;", a);
assert.ok(c > a && c < b, "promoter half of tellShowSent found");
const mail = strip(fn.slice(c, b));
const confirmText = mail.match(/const confirmText = ([\s\S]*?);\n/);
const html = mail.match(/const html = `([\s\S]*?)`;\n/);
assert.ok(confirmText && html, "confirmation text and html found");
for (const [k, v] of [["text", confirmText[1]], ["html", html[1]]]) {
  assert.ok(!/Dylan|Sebastiani/i.test(v), `confirmation email ${k} must not name Dylan`);
  assert.ok(/ticketLink/.test(v), `confirmation email ${k} carries the ticket link`);
}
assert.ok(/usually within a day, and email you a preview/.test(mail), "email says what happens next");
assert.ok(/await sendOnce\(\{ to: \[who\]/.test(mail), "still sent with sendOnce");
assert.ok(!/Dylan|Sebastiani/i.test(mail), "nothing in the promoter confirmation names Dylan");

// 2. Promoter screens: strings a promoter reads (comments may keep the name).
for (const f of ["../site/assets/promoter.js", "../site/promoter.html", "../site/demo.html", "../site/assets/savings.js"]) {
  assert.ok(!/Dylan|Sebastiani/i.test(strip(read(f))), f + " must not name Dylan");
}

// 3. Home: show card, one next step while setting up, the everyday buttons once live, everything optional on More.
const js = strip(read("../site/assets/promoter.js"));
assert.ok(/class="card sumcard"/.test(js) && /id=copylink/.test(js) && /No sales yet/.test(js), "show card with copy button and No sales yet");
assert.ok(/Tickets sold/.test(js) && /Ticket money/.test(js), "show card shows tickets sold and ticket money");
assert.ok(/View my page/.test(js) && /me\.html#show=/.test(js) && /Door and guest list/.test(js), "live show card links the page and the door");
assert.ok(/'<a class=btn href="' \+ steps\[nextI\]\.href \+ '">Next: '/.test(js), "one next-step button while setting up");
assert.ok(/if \(h\[0\] === "more"\) return more\(\)/.test(js), "More screen is routed");
const moreFn = js.slice(js.indexOf("function more()"), js.indexOf("function promoters()"));
assert.ok(/id=pxsave/.test(moreFn) && /referralHtml\(co\)/.test(moreFn) && /#brand/.test(moreFn), "ad pixel, referral and brand live on More");
assert.ok(/id=paycard/.test(js) && /We'll email you when it opens/.test(js), "payouts card with the not-open note");
assert.ok(/Step ' \+ n \+ " of 4/.test(js) && !/of 3 ·/.test(js) && !/" of 5"/.test(js), "one four-step counter");
assert.ok(/You keep your full ticket price/.test(js) && /No passwords/.test(js), "sign-in lines");
console.log("promoter-home ok");
