// Locks the referral credit rules: half the buyer fee, first show only, no comps, no refunds, live show excluded.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  UNDERGROUND_EVENT_ID,
  NOTE_DRIFT,
  creditLine,
  orderCredit,
  creditsForReferral,
  ledgerWrites,
} from "../supabase/functions/_shared/referral_math.mjs";

const banned = (s) => {
  assert.equal(s.includes("\u2014"), false, "em dash");
  assert.equal(s.includes("\u2013"), false, "en dash");
  assert.equal(s.includes(";"), false, "semicolon");
  assert.equal(s.includes("?"), false, "question");
};

const line = creditLine(1, 5000, 150);
assert.match(line, /first show/);
assert.match(line, /\$1\.50/);
assert.match(line, /\$0\.75/);
assert.match(line, /Nothing is sent on its own/);
banned(line);
const later = creditLine(3, 5000, 150);
assert.match(later, /first 3 shows/);
banned(later);
banned(creditLine(1, 5000, null));
banned(NOTE_DRIFT);

const ticket = (over = {}) => ({ status: "valid", is_comp: false, unit_cents: 2500, ...over });
const order = (over = {}) => ({ id: "o1", event_id: "show-a", status: "paid", platform_fee_cents: 150, paid_at: "2026-06-01T00:00:00Z", ...over });

assert.deepEqual(orderCredit(order(), [ticket()], 5000), { tickets: 1, fee: 150, credit: 75 });
assert.deepEqual(orderCredit(order({ platform_fee_cents: 300 }), [ticket(), ticket()], 5000), { tickets: 2, fee: 300, credit: 150 });
assert.deepEqual(orderCredit(order(), [ticket({ is_comp: true })], 5000).credit, 0);
assert.deepEqual(orderCredit(order({ status: "comp", platform_fee_cents: 0 }), [ticket({ is_comp: true, unit_cents: 0 })], 5000).credit, 0);
assert.deepEqual(orderCredit(order({ status: "refunded" }), [ticket({ status: "void" })], 5000).credit, 0);
assert.deepEqual(orderCredit(order(), [ticket({ status: "void" }), ticket()], 5000), { tickets: 1, fee: 75, credit: 38 });
assert.deepEqual(orderCredit(order({ platform_fee_cents: 0 }), [ticket()], 5000).credit, 0);
assert.deepEqual(orderCredit(order(), [ticket()], 0).credit, 0);

const show = (id, starts, status = "approved") => ({ id, slug: id, name: id, review_status: status, starts_at: starts, created_at: starts });
const paid = (id, event, fee, when) => ({ id, event_id: event, status: "paid", platform_fee_cents: fee, paid_at: when, items: [{ unit_cents: 2500, qty: fee / 150 }] });

const firstOnly = creditsForReferral({
  events: [show("b", "2026-08-01"), show("a", "2026-07-01"), show("draft", "2026-06-01", "draft")],
  orders: [paid("1", "b", 150, "2026-05-01"), paid("2", "a", 300, "2026-07-02")],
  ticketsByOrder: {},
  shareBps: 5000,
  showLimit: 1,
});
assert.deepEqual(firstOnly.map((r) => r.event_id), ["b"]);
assert.equal(firstOnly[0].credit, 75);
assert.equal(firstOnly[0].tickets, 1);

const three = creditsForReferral({
  events: [show("a", "2026-07-01"), show("b", "2026-08-01"), show("c", "2026-09-01")],
  orders: [paid("1", "a", 150, "2026-07-02"), paid("2", "b", 150, "2026-08-02"), paid("3", "c", 150, "2026-09-02")],
  ticketsByOrder: {},
  shareBps: 5000,
  showLimit: 3,
});
assert.deepEqual(three.map((r) => r.event_id), ["a", "b", "c"]);
assert.deepEqual(three.map((r) => r.show_rank), [1, 2, 3]);

const live = creditsForReferral({
  events: [{ id: UNDERGROUND_EVENT_ID, slug: "underground", review_status: "approved", starts_at: "2026-01-01", created_at: "2026-01-01" }, show("a", "2026-07-01")],
  orders: [paid("1", UNDERGROUND_EVENT_ID, 150, "2026-01-02"), paid("2", "a", 150, "2026-07-02")],
  ticketsByOrder: {},
  shareBps: 5000,
  showLimit: 1,
});
assert.deepEqual(live.map((r) => r.event_id), ["a"]);

const legacy = creditsForReferral({
  events: [{ id: "q", slug: "night", review_status: "approved", starts_at: "2026-01-01", created_at: "2026-01-01", legacy: true }],
  orders: [paid("1", "q", 150, "2026-01-02")],
  ticketsByOrder: {},
  shareBps: 5000,
  showLimit: 1,
});
assert.equal(legacy.length, 0);

const refunded = creditsForReferral({
  events: [show("a", "2026-07-01")],
  orders: [{ id: "1", event_id: "a", status: "refunded", platform_fee_cents: 150, paid_at: "2026-07-02" }],
  ticketsByOrder: { "1": [{ status: "void", is_comp: false, unit_cents: 2500 }] },
  shareBps: 5000,
  showLimit: 1,
});
assert.equal(refunded.length, 0);

const existing = [{ id: "c1", event_id: "a", status: "settled", paid_tickets: 2, fee_cents: 300, credit_cents: 150, show_rank: 1 }];
const drifted = ledgerWrites(existing, [{ event_id: "a", show_rank: 1, tickets: 1, fee: 150, credit: 75 }]);
assert.equal(drifted.length, 1);
assert.equal(drifted[0].op, "note");
assert.equal(drifted[0].note, NOTE_DRIFT);

const wiped = ledgerWrites(
  [{ id: "c1", event_id: "a", status: "pending", paid_tickets: 2, fee_cents: 300, credit_cents: 150, show_rank: 1 }],
  [],
);
assert.equal(wiped[0].op, "void");
assert.equal(wiped[0].credit_cents, 0);

const fresh = ledgerWrites([], [{ event_id: "a", show_rank: 1, tickets: 1, fee: 150, credit: 75 }]);
assert.equal(fresh[0].op, "insert");
assert.equal(fresh[0].status, "pending");

const sql = readFileSync(new URL("../supabase/migrations/0051_promoter_referral_credit.sql", import.meta.url), "utf8");
assert.match(sql, /63b511f3-d838-404f-9c2e-5d4b98fbf013/);
assert.match(sql, /promoter_referral_share_bps/);
assert.match(sql, /5000/);
assert.match(sql, /promoter_referral_show_limit/);
assert.match(sql, /legacy_stripe/);
assert.match(sql, /on conflict \(referred_company_id\) do nothing/);
assert.match(sql, /enable row level security/);
assert.doesNotMatch(sql, /create policy/i);
assert.doesNotMatch(sql, /transfers/);
assert.doesNotMatch(sql, /application_fee/);

const held = ["tickets/index.ts", "stripe-webhook/index.ts", "door/index.ts", "admin/index.ts", "subscribe/index.ts", "email-runner/index.ts"];
const touched = ["supabase/functions/_shared/referrals.ts", "supabase/functions/promoter/index.ts", "supabase/functions/demo/index.ts", "supabase/functions/owner/index.ts"];
for (const f of touched) {
  const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
  for (const h of held) assert.equal(src.includes(h), false, f + " must not name " + h);
}
assert.doesNotMatch(readFileSync(new URL("../supabase/functions/_shared/referrals.ts", import.meta.url), "utf8"), /api\.stripe\.com|application_fee|ticket_orders"\)\.update/);

console.log("referrals.test.mjs passed");
