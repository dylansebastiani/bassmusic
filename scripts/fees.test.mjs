// Locks the fee calculator to checkout's one-ticket total, and to the published competitor rates.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../site/assets/fees.js", import.meta.url), "utf8"), ctx);
const F = ctx.SubductionFees;

// checkout totals() for one paid ticket: ceil((price + 150 + 30) / 0.971)
assert.equal(F.checkoutTotal(2500, 1), 2761);
assert.equal(F.feeCents(2500), 261);
assert.equal(F.checkoutTotal(0, 1), 0);
assert.equal(F.feeCents(0), 0);
assert.equal(F.checkoutTotal(1000, 1), 1216);
assert.equal(F.feeCents(1000), 216);
// A multi-ticket order charges the 30¢ once. The page does not use that total.
assert.equal(F.checkoutTotal(10000, 4), 10948);
assert.equal(F.quote(2500, 4).feesCents, 261 * 4);
assert.equal(F.quote(2500, 4).keepCents, 10000);
assert.equal(F.quote(2500, 1).subBuyer, 2761);
assert.equal(F.quote(2500, 1).cardCents, 111);

// Homepage comparison on a $25 ticket, and Eventbrite's own worked examples at $20 and $50.
assert.equal(F.eventbriteFeeCents(2500), 352);
assert.equal(F.eventbriteFeeCents(2000), 318);
assert.equal(F.eventbriteFeeCents(5000), 520);
assert.equal(F.poshFeeCents(2500), 349);
assert.equal(F.diceFeeCents(2500), 325);
assert.equal(F.eventbriteFeeCents(0), 0);
assert.equal(F.poshFeeCents(0), 0);
assert.equal(F.diceFeeCents(0), 0);

const page = readFileSync(new URL("../site/fees.html", import.meta.url), "utf8");
const copy = page.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
assert.equal(page.toLowerCase().includes("powered by"), false);
assert.equal(copy.includes("—"), false);
assert.equal(copy.includes(";"), false);
assert.equal(copy.includes("?"), false);
const jsCopy = [...readFileSync(new URL("../site/assets/fees.js", import.meta.url), "utf8").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join("\n");
assert.equal(jsCopy.includes("—"), false);
assert.equal(jsCopy.includes(";"), false);
assert.equal(jsCopy.includes("?"), false);
