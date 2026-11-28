// Only a company owner (or Subduction's owner) may count or email a crowd. Other staff are refused.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const co = readFileSync(new URL("../supabase/functions/_shared/company.ts", import.meta.url), "utf8");
const m = co.match(/export const canManage = \(st: Staff, companyId: string \| null \| undefined\) =>\s*([^;]+);/);
assert.ok(m, "canManage not found");
const canManage = new Function("st", "companyId", "return " + m[1]);

const owner = { owner: false, companies: [{ id: "c1", role: "owner" }] };
const staff = { owner: false, companies: [{ id: "c1", role: "staff" }] };
const other = { owner: false, companies: [{ id: "c2", role: "owner" }] };
const admin = { owner: true, companies: [] };
assert.equal(canManage(owner, "c1"), true);
assert.equal(canManage(admin, "c1"), true);
assert.equal(canManage(staff, "c1"), false);
assert.equal(canManage(other, "c1"), false);
assert.equal(canManage(owner, null), false);

// The crowd handler must check it before counting or sending anything.
const src = readFileSync(new URL("../supabase/functions/promoter/index.ts", import.meta.url), "utf8");
const i = src.indexOf('if (a === "crowd-count" || a === "crowd-send") {');
assert.ok(i > 0, "crowd block not found");
const block = src.slice(i);
const guard = block.indexOf("canManage(st, show.company_id)");
assert.ok(guard > 0 && guard < block.indexOf("audience(") && guard < block.indexOf('from("crowd_sends")'), "owner check must come first");
assert.match(block.slice(guard, guard + 160), /403/);
console.log("crowd-access ok");
