// Street-team links: paid tickets and revenue per ?ref=, optional payout the promoter owes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normRef, streetLine, planLink, orderShare, rollup } from "../supabase/functions/_shared/street_math.mjs";

const banned = (s) => {
  assert.equal(s.includes("\u2014"), false);
  assert.equal(s.includes("\u2013"), false);
  assert.equal(s.includes(";"), false);
  assert.equal(s.includes("?"), false);
};
banned(streetLine());
assert.match(streetLine(), /Subduction does not move that money/);

assert.equal(normRef("DJ Name"), "dj-name");
assert.equal(normRef("  djname "), "djname");
assert.equal(planLink({ label: "DJ Name" }).code, "dj-name");
assert.equal(planLink({ label: "DJ Name", code: "djname", payout: "2.50" }).payout_cents, 250);
assert.equal(planLink({ label: "DJ Name", payout: "" }).payout_cents, null);
assert.equal(planLink({ label: "" }).error, "Give the link a name.");
assert.ok(planLink({ label: "DJ", payout: "1001" }).error);

const t = (over = {}) => ({ status: "valid", is_comp: false, unit_cents: 2500, ...over });
const paid = (over = {}) => ({ id: "o1", status: "paid", ref: "DJName", discount_cents: 0, ...over });

assert.deepEqual(orderShare(paid(), [t(), t()]), { tickets: 2, revenue: 5000 });
assert.deepEqual(orderShare(paid({ discount_cents: 500 }), [t(), t()]), { tickets: 2, revenue: 4500 });
assert.deepEqual(orderShare(paid({ discount_cents: 500 }), [t({ status: "void" }), t()]), { tickets: 1, revenue: 2250 });
assert.deepEqual(orderShare(paid({ status: "refunded" }), [t({ status: "void" })]), { tickets: 0, revenue: 0 });
assert.deepEqual(orderShare(paid({ status: "comp" }), [t({ is_comp: true, unit_cents: 0 })]), { tickets: 0, revenue: 0 });
assert.deepEqual(orderShare({ id: "o1", status: "paid", discount_cents: 0, items: [{ unit_cents: 2000, qty: 2 }] }, []), { tickets: 2, revenue: 4000 });

const rows = rollup(
  [{ id: "l1", code: "djname", label: "DJ Name", payout_cents: 200 }],
  [
    { id: "o1", status: "paid", ref: "DJName", discount_cents: 0 },
    { id: "o2", status: "paid", ref: "flyer", discount_cents: 0 },
    { id: "o3", status: "refunded", ref: "djname", discount_cents: 0 },
    { id: "o4", status: "comp", ref: "djname", discount_cents: 0 },
  ],
  {
    o1: [t(), t()],
    o2: [t()],
    o3: [t({ status: "void" })],
    o4: [t({ is_comp: true, unit_cents: 0 })],
  },
);
const named = rows.find((r) => r.code === "djname");
const extra = rows.find((r) => r.code === "flyer");
assert.equal(named.tickets, 2);
assert.equal(named.revenue_cents, 5000);
assert.equal(named.owed_cents, 400);
assert.equal(named.saved, true);
assert.equal(extra.saved, false);
assert.equal(extra.tickets, 1);
assert.equal(extra.owed_cents, null);
assert.equal(rows.some((r) => r.code === "comp"), false);

const sql = readFileSync(new URL("../supabase/migrations/0052_street_links.sql", import.meta.url), "utf8");
assert.match(sql, /63b511f3-d838-404f-9c2e-5d4b98fbf013/);
assert.match(sql, /enable row level security/);
assert.match(sql, /legacy_stripe/);
assert.doesNotMatch(sql, /create policy/i);
assert.doesNotMatch(sql, /transfers|application_fee/);

const show = readFileSync(new URL("../site/assets/show.js", import.meta.url), "utf8");
assert.match(show, /data\.lane === 2 \? linkRef : \(ref \|\| null\)/);
const stack = readFileSync(new URL("../site/assets/stack.js", import.meta.url), "utf8");
assert.match(stack, /"ref"/);

const held = ["tickets/index.ts", "stripe-webhook/index.ts", "door/index.ts", "admin/index.ts", "subscribe/index.ts", "email-runner/index.ts", "checkout/index.ts"];
for (const f of ["supabase/functions/_shared/street.ts", "supabase/functions/promoter/index.ts", "site/assets/show.js"]) {
  const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
  for (const h of held) assert.equal(src.includes(h), false, f + " must not name " + h);
}

console.log("street-links.test.mjs passed");
