// Locks the rule: only a company's owner sees per-show revenue. Other crew get no `sales` field.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canSeeSalesInPromoter } from "../supabase/functions/_shared/sales_access.mjs";

// Same logic as canManage() in company.ts, run against a crew list.
const canManage = (st, id) => !!id && (st.owner || st.companies.some((c) => c.id === id && c.role === "owner"));
const crew = { owner: false, companies: [{ id: "a", role: "owner" }, { id: "b", role: "staff" }] };
assert.equal(canSeeSalesInPromoter(canManage(crew, "a")), true, "owner sees revenue");
assert.equal(canSeeSalesInPromoter(canManage(crew, "b")), false, "non-owner crew gets no revenue");
assert.equal(canSeeSalesInPromoter(canManage(crew, "zzz")), false, "stranger gets no revenue");
assert.equal(canSeeSalesInPromoter(canManage({ owner: true, companies: [] }, "b")), true, "Subduction staff still sees it");

// The functions must actually use the rule (guards against someone dropping it).
const acct = readFileSync(new URL("../supabase/functions/account/index.ts", import.meta.url), "utf8");
assert.equal((acct.match(/c\.kind === "promoter" && c\.role === "owner"/g) || []).length, 2, "account: both sales spots owner-only");
assert.ok(!/c\.kind === "promoter" \? \{ sales/.test(acct), "account: no kind-only sales");
const prom = readFileSync(new URL("../supabase/functions/promoter/index.ts", import.meta.url), "utf8");
assert.equal((prom.match(/canSeeSalesInPromoter\(canManage\(st, s\.company_id\)\)/g) || []).length, 2, "promoter me: both sales spots gated by canManage");
console.log("sales-access ok");
