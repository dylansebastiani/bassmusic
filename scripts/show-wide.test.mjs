// Issue #70 item 2. Promoter show pages get a wide desktop layout with a sticky buy module.
// Fails if the wide rules go missing, if any of them is not scoped to .show, or if app.css .wrap
// (shared by every other page) is changed to do the job instead.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const css = read("../site/assets/show.css").replace(/\/\*[\s\S]*?\*\//g, "");
const at = css.indexOf("@media (min-width:1100px){");
assert.ok(at >= 0, "show.css has the wide desktop block");
let depth = 0, end = -1;
for (let i = css.indexOf("{", at); i < css.length; i++) { if (css[i] === "{") depth++; else if (css[i] === "}" && --depth === 0) { end = i; break; } }
const block = css.slice(css.indexOf("{", at) + 1, end);
const rules = [...block.matchAll(/([^{}]+)\{[^{}]*\}/g)];
assert.ok(rules.length >= 5, "wide block has its rules");
for (const [, sel] of rules) for (const one of sel.split(",")) assert.ok(one.trim().startsWith(".show #page:has(.s-tickets)"), "wide rule not scoped to .show: " + one.trim());
assert.ok(/grid-template-columns:minmax\(0,1fr\) 400px/.test(block), "two columns: flyer and details, then buy");
assert.ok(/>\.s-tickets\{position:sticky;top:24px/.test(block), "buy module is sticky");
assert.ok(/:has\(#payWrap:not\(\[hidden\]\)\)\{position:static/.test(block), "sticky turns off while paying");
// The phone column and every page that shares .wrap stay as they are.
assert.ok(/\.show \.wrap\{max-width:560px\}/.test(css), "show.css phone column unchanged");
assert.ok(/^\.wrap\{max-width:560px;margin:0 auto\}$/m.test(read("../site/assets/app.css")), "app.css .wrap unchanged");
console.log("show-wide ok");
