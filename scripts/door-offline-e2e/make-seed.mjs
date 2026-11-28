// Writes seed.json: one two-night test show with PIN 4321 and six tickets (night 1, night 2, three passes, one void, one guest list).
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const ev = randomUUID(), n1 = randomUUID(), n2 = randomUUID(), t1 = randomUUID(), t2 = randomUUID(), tp = randomUUID(), o1 = randomUUID(), o2 = randomUUID();
const salt = "test-salt", now = Date.now(), iso = (ms) => new Date(ms).toISOString();
const tk = (code, tok, name, type, extra = {}) => ({ id: randomUUID(), order_id: o1, event_id: ev, type_id: type, code, token: tok.repeat(24), holder_name: name, email: "t@example.com", tier: "GA", unit_cents: 0, is_comp: false, status: "valid", ...extra });
const seed = {
  settings: [{ key: "ip_salt", value: salt }, { key: "admin_emails", value: [] }],
  events: [{ id: ev, slug: "door-offline-test", name: "Door offline test", sales_open: false, door_pin_hash: sha(`door|${ev}|4321|${salt}`) }],
  ticket_nights: [
    { id: n1, event_id: ev, slug: "n1", label: "Night 1", starts_at: iso(now - 3600e3), ends_at: iso(now + 5 * 3600e3), sort: 0 },
    { id: n2, event_id: ev, slug: "n2", label: "Night 2", starts_at: iso(now + 24 * 3600e3), ends_at: iso(now + 30 * 3600e3), sort: 1 }],
  ticket_types: [
    { id: t1, event_id: ev, slug: "night-1", name: "Night 1", night_ids: [n1], tiers: [], sort: 0 },
    { id: t2, event_id: ev, slug: "night-2", name: "Night 2", night_ids: [n2], tiers: [], sort: 1 },
    { id: tp, event_id: ev, slug: "pass", name: "Both nights", night_ids: [n1, n2], tiers: [], sort: 2 }],
  ticket_orders: [{ id: o1, event_id: ev, status: "paid", name: "Buyer" }, { id: o2, event_id: ev, status: "comp", name: "Guest", comp_list: "Mook" }],
  tickets: [
    tk("OFFTST01", "a1", "Alex Night One", t1),
    tk("OFFTST02", "b2", "Bea Night Two", t2),
    tk("OFFTST03", "c3", "Cam Pass", tp),
    tk("OFFTST04", "d4", "Dee Guest", tp, { order_id: o2, is_comp: true, tier: "Guest list" }),
    tk("OFFTST05", "e5", "Eli Void", tp, { status: "void" }),
    tk("OFFTST06", "f6", "Fay Pass", tp),
    tk("OFFTST07", "a7", "Gus Pass", tp)],
};
writeFileSync(new URL("./seed.json", import.meta.url), JSON.stringify(seed, null, 1));
console.log(JSON.stringify({ n1, n2 }));
