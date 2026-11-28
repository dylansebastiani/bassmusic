// The People page can email real people. These tests run the staff actions with a fake database and a stubbed Brevo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeStaff, TOFTU_EVENT } from "../supabase/functions/owner/staff.mjs";

// Minimal in-memory stand-in for the supabase-js query builder (select/insert/update/delete, eq/gte/order/limit/single).
function fakeDb(tables) {
  let seq = 0, tick = 0;
  const get = (row, col) => col.includes("->>") ? (row[col.split("->>")[0]] || {})[col.split("->>")[1]] : row[col];
  const from = (name) => {
    const t = (tables[name] = tables[name] || []);
    const q = { op: "select", filters: [], order: [], lim: null, one: false, patch: null, row: null };
    const run = () => {
      if (q.op === "insert") {
        const r = { id: "id" + (++seq), created_at: new Date(Date.now() + (++tick)).toISOString(), ...q.row }; t.push(r);
        return { data: q.one ? r : [r], error: null };
      }
      let rows = t.filter((r) => q.filters.every(([k, c, v]) => c === "eq" ? get(r, k) === v : get(r, k) >= v));
      if (q.op === "update") { rows.forEach((r) => Object.assign(r, q.patch)); return { data: rows, error: null }; }
      if (q.op === "delete") { rows.forEach((r) => t.splice(t.indexOf(r), 1)); return { data: null, error: null }; }
      for (const [k, asc] of [...q.order].reverse()) rows = [...rows].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
      if (q.lim != null) rows = rows.slice(0, q.lim);
      return { data: q.one ? rows[0] ?? null : rows, error: null };
    };
    const api = {
      select() { return api; }, insert(r) { q.op = "insert"; q.row = r; return api; }, update(p) { q.op = "update"; q.patch = p; return api; }, delete() { q.op = "delete"; return api; },
      eq(k, v) { q.filters.push([k, "eq", v]); return api; }, gte(k, v) { q.filters.push([k, "gte", v]); return api; },
      order(k, o) { q.order.push([k, o?.ascending !== false]); return api; }, limit(n) { q.lim = n; return api; }, single() { q.one = true; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return api;
  };
  return { from };
}

const admin = { id: "staff1", email: "dylan@example.com" };
const GOOD = { a: "send", to: "Fan@Example.com", kind: "custom", subject: "Hello there", body: "Hi, quick note from Dylan." };
function setup(tables = {}, { blocked = false, brevoOk = true } = {}) {
  tables.subscribers = tables.subscribers || [{ id: "s1", email: "fan@example.com", status: "active", unsubscribe_token: "tok-1", event_id: null }];
  const db = fakeDb(tables), sent = [];
  const brevo = { send: async (m) => { sent.push(m); return brevoOk ? { ok: true } : { ok: false, status: 500, error: "boom" }; } };
  const s = makeStaff({ db, brevo, fnBase: "https://x.supabase.co/functions/v1", fromEmail: "hello@subduction.art", brevoBlocked: async () => blocked,
    config: { mailingAddress: "1 Main St", fromName: "Dylan @ Subduction" } });
  return { s, sent, tables };
}
const events = (t, type) => (t.engagement_events || []).filter((e) => e.type === type);

// Send works, goes out from Brevo with a real unsubscribe link, and is logged.
{
  const { s, sent, tables } = setup();
  const r = await s.post(GOOD, admin);
  assert.equal(r.status, 200); assert.equal(sent.length, 1);
  assert.equal(sent[0].to.email, "fan@example.com");
  assert.match(sent[0].headers["List-Unsubscribe"], /unsubscribe\?u=tok-1>/);
  assert.match(sent[0].html, /unsubscribe\?u=tok-1/); assert.doesNotMatch(sent[0].html + sent[0].text, /reply "stop"/);
  assert.equal(events(tables, "staff:email").length, 1); assert.equal(events(tables, "staff:email")[0].meta.ok, true);
}
// Not in Subduction = not sent. Bad input = not sent.
{
  const { s, sent } = setup();
  assert.equal((await s.post({ ...GOOD, to: "stranger@example.com" }, admin)).status, 400);
  assert.equal((await s.post({ ...GOOD, to: "not-an-email" }, admin)).status, 400);
  assert.equal((await s.post({ ...GOOD, to: "%@example.com" }, admin)).status, 400, "wildcards are not matched");
  assert.equal((await s.post({ ...GOOD, subject: "x" }, admin)).status, 400);
  assert.equal((await s.post({ ...GOOD, kind: "spam" }, admin)).status, 400);
  assert.equal(sent.length, 0);
}
// T.O.F.T.U. people are never emailed, and can't be logged against either.
for (const t of [
  { ticket_orders: [{ id: "o1", email: "fan@example.com", event_id: TOFTU_EVENT }], subscribers: [] },
  { artist_invites: [{ id: "i1", email: "fan@example.com", event_id: TOFTU_EVENT }], subscribers: [] },
  { ticket_orders: [{ id: "o1", email: "fan@example.com", event_id: TOFTU_EVENT }] },
  { subscribers: [{ id: "s1", email: "fan@example.com", status: "active", event_id: TOFTU_EVENT }] },
]) {
  const { s, sent } = setup(t);
  assert.equal((await s.post(GOOD, admin)).status, 400); assert.equal(sent.length, 0);
  assert.equal((await s.post({ a: "log", to: "fan@example.com", kind: "note", text: "hi" }, admin)).status, 400);
}
// A buyer of some other show is still fine.
{
  const { s, sent } = setup({ ticket_orders: [{ id: "o1", email: "fan@example.com", event_id: "other-show" }], subscribers: [] });
  assert.equal((await s.post(GOOD, admin)).status, 200); assert.equal(sent.length, 1);
}
// Every status that isn't active blocks.
for (const status of ["unsubscribed", "bounced", "complained", "sunset", "deleted"]) {
  const { s, sent } = setup({ subscribers: [{ id: "s1", email: "fan@example.com", status, unsubscribe_token: "t" }] });
  assert.equal((await s.post(GOOD, admin)).status, 409, status); assert.equal(sent.length, 0, status);
}
// "They said stop" blocks. A Brevo block (demo ticket unsubscribe) blocks. Brevo unreachable fails closed.
{
  const { s, sent } = setup();
  assert.equal((await s.post({ a: "log", to: "fan@example.com", kind: "stop" }, admin)).status, 200);
  assert.equal((await s.post(GOOD, admin)).status, 409); assert.equal(sent.length, 0);
}
{
  const { s, sent } = setup({}, { blocked: true });
  assert.equal((await s.post(GOOD, admin)).status, 409); assert.equal(sent.length, 0);
  const n = setup({}, { blocked: null });
  assert.equal((await n.s.post(GOOD, admin)).status, 409); assert.equal(n.sent.length, 0);
}
// A demo lead with no member record gets their demo unsubscribe link.
{
  const { s, sent } = setup({ subscribers: [], demo_leads: [{ email: "fan@example.com", token: "demo-tok" }] });
  assert.equal((await s.post(GOOD, admin)).status, 200);
  assert.match(sent[0].headers["List-Unsubscribe"], /demo\?a=unsub&t=demo-tok>/);
}
// Notes: need text, are saved against the staff member, and only for known people.
{
  const { s, tables } = setup();
  assert.equal((await s.post({ a: "log", to: "fan@example.com", kind: "note", text: "  " }, admin)).status, 400);
  assert.equal((await s.post({ a: "log", to: "fan@example.com", kind: "note", text: "Called, call back Friday" }, admin)).status, 200);
  assert.equal((await s.post({ a: "log", to: "stranger@example.com", kind: "note", text: "x" }, admin)).status, 400);
  assert.equal((await s.post({ a: "log", to: "fan@example.com", kind: "delete" }, admin)).status, 400);
  const n = events(tables, "staff:note"); assert.equal(n.length, 1); assert.equal(n[0].subscriber_id, "staff1"); assert.equal(n[0].meta.to, "fan@example.com");
}
// Rate limit: ten sends at once to one person, only one goes out.
{
  const { s, sent, tables } = setup();
  const rs = await Promise.all(Array.from({ length: 10 }, () => s.post(GOOD, admin)));
  assert.equal(rs.filter((r) => r.status === 200).length, 1); assert.equal(rs.filter((r) => r.status === 429).length, 9);
  assert.equal(sent.length, 1); assert.equal(events(tables, "staff:email").length, 1, "losing claims are removed");
  assert.equal((await s.post(GOOD, admin)).status, 429, "one per person per 10 minutes");
}
// Rate limit: 20 an hour per staff member, even to 30 different people, even all at once.
{
  const subs = Array.from({ length: 30 }, (_, i) => ({ id: "s" + i, email: `f${i}@example.com`, status: "active", unsubscribe_token: "t" + i }));
  const { s, sent } = setup({ subscribers: subs });
  const rs = await Promise.all(subs.map((x) => s.post({ ...GOOD, to: x.email }, admin)));
  assert.equal(rs.filter((r) => r.status === 200).length, 20); assert.equal(sent.length, 20);
  assert.ok(rs.every((r) => r.status === 200 || r.status === 429));
  const other = await s.post({ ...GOOD, to: "f25@example.com" }, { id: "staff2", email: "b@example.com" });
  assert.equal(other.status, 200, "another staff member has their own 20");
}
// A Brevo failure is logged as failed and reported.
{
  const { s, tables } = setup({}, { brevoOk: false });
  assert.equal((await s.post(GOOD, admin)).status, 502);
  assert.equal(events(tables, "staff:email")[0].meta.ok, false);
}

// Staff gate and wiring: source checks on the function itself.
const src = readFileSync(new URL("../supabase/functions/owner/index.ts", import.meta.url), "utf8");
assert.match(src, /const admin = await requireAdmin\(req\);\s*\n\s*if \(!admin\) return json\(\{ error: "Sign in again\." \}, 401\);\s*\n\s*if \(req\.method === "POST"\) return post\(req, admin\)/, "POST is behind the staff sign-in");
assert.match(src, /isLimited|ends - made <= 2 \* 86400000\) return null/, "limited member-key sessions are refused");
assert.match(src, /list\.map\(\(e\) => String\(e\)\.toLowerCase\(\)\)\.includes/, "only addresses on the staff list pass");
assert.doesNotMatch(src + readFileSync(new URL("../supabase/functions/owner/staff.mjs", import.meta.url), "utf8"), /ilike|reply "stop"/, "no wildcard matching, no reply-stop promise");
assert.match(readFileSync(new URL("../site/assets/people.css", import.meta.url), "utf8"), /\.sh-x\{[^}]*min-height:40px/, "Close button is at least 40px tall");
console.log("owner-staff ok");
