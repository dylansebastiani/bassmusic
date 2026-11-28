// People page: a mailto link is built only for a plain address, so a stored value can't prefill a
// subject or body. Anything else shows as escaped plain text. Phone links keep digits and + only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../site/assets/people.js", import.meta.url), "utf8");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const win = { Stack: { C: {}, esc } };
win.window = win;
win.document = { getElementById: () => ({ addEventListener() {}, value: "" }) };
win.localStorage = { getItem: () => null }; // no token: the script stops after setup
vm.runInNewContext(src, win);
const { mail, call } = win.PeopleLinks;

assert.equal(mail("fan@example.com"), '<a href="mailto:fan%40example.com">fan@example.com</a>');
assert.equal(mail("a.b+tag@mail.example.co"), '<a href="mailto:a.b%2Btag%40mail.example.co">a.b+tag@mail.example.co</a>');
for (const bad of [
  "a@b.com?body=owned", "a@b.com?subject=x&body=y", "a@b.com#frag", "a@b.com&cc=x@y.com",
  "a@b.com\nBcc: x@y.com", "a@b.com\r\nbody=1", "a b@c.com", "a@b.com ", "a@b.com\u0000", "a@b.com%0Abody=1",
  "<img src=x onerror=alert(1)>@b.com", '"><script>alert(1)</script>@b.com', "javascript:alert(1)", "a@b", "",
]) {
  const out = mail(bad);
  assert.ok(!/<a\b/i.test(out), "no link for " + JSON.stringify(bad));
  assert.ok(!/[<>"]/.test(out.replace(/&(lt|gt|quot|amp|#39);/g, "")), "escaped: " + JSON.stringify(bad));
}
assert.equal(call("(555) 123-4567"), '<a href="tel:5551234567">(555) 123-4567</a>');
assert.equal(call('+1 555";onclick="x'), '<a href="tel:+1555">+1 555&quot;;onclick=&quot;x</a>');
assert.equal(call("none"), "none");
// Staff gate: the list is only fetched with a token, and the sign-in message shows without one.
assert.match(src, /if \(!tok\) return signIn\(\);\s*fetch\(/);
console.log("people-links ok");
