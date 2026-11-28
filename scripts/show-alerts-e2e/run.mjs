// End-to-end check of city show alerts against the real directory/index.ts, with an in-memory database and a fake
// Brevo. Run: node --experimental-strip-types scripts/show-alerts-e2e/run.mjs  (not part of npm run check: it rewrites imports)
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const root = new URL("../..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "alerts-e2e-"));
cpSync(join(root, "supabase/functions/directory"), join(dir, "directory"), { recursive: true });
cpSync(join(root, "supabase/functions/_shared/client_ip.mjs"), join(dir, "client_ip.mjs"));
// Swap the Deno-only imports for local stubs.
let src = readFileSync(join(dir, "directory/index.ts"), "utf8")
  .replace('import { ipFromHeaders } from "../_shared/client_ip.mjs";', 'import { ipFromHeaders } from "../client_ip.mjs";')
  .replace('import { clientIp, verifyTurnstile } from "../_shared/util.ts";', 'const clientIp = () => "1.2.3.4"; const verifyTurnstile = async (t: any) => t === "ok";')
  .replace('import { CONFIG } from "../_shared/config.ts";', 'const CONFIG = { mailingAddress: "802 South Morris Avenue, Bloomington, IL 61701", siteUrl: "https://subduction.art" };')
  .replace('import { createClient } from "npm:@supabase/supabase-js@2.45.4";', 'const createClient = (globalThis as any).__fakeClient;');
writeFileSync(join(dir, "directory/index.ts"), src);

// ---- fake supabase-js: just the calls the directory function makes ----
const T = { show_alerts: [], show_alert_shows: [], settings: [{ key: "ip_salt", value: "salt" }, { key: "mailing_address", value: "802 South Morris Avenue, Bloomington, IL 61701" }],
  events: [], ticket_nights: [], directory_listings: [] };
let rate = 0;
function q(table) {
  const st = { table, filters: [], op: "select", cols: "*", opts: {}, rows: null, single: false, limit: 1e9, head: false };
  const match = (r) => st.filters.every(([k, op, v]) => op === "eq" ? String(r[k]).toLowerCase() === String(v).toLowerCase() : op === "in" ? v.includes(r[k]) : op === "is" ? (r[k] ?? null) === v : op === "gte" ? r[k] >= v : true);
  const run = () => {
    const rows = T[table] || (T[table] = []);
    if (st.op === "insert") {
      for (const r of st.rows) { if (table === "show_alerts" && rows.some((x) => x.email === r.email && x.city_path === r.city_path)) return { data: null, error: { code: "23505", message: "duplicate" } }; rows.push({ id: crypto.randomUUID(), sent_count: 0, unsubscribed_at: null, ...r }); }
      return { data: null, error: null };
    }
    if (st.op === "upsert") {
      const added = [];
      for (const r of st.rows) if (!rows.some((x) => x.show_key === r.show_key)) { rows.push({ ...r }); added.push({ show_key: r.show_key }); }
      return { data: added, error: null };
    }
    if (st.op === "update") { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, st.rows)); return { data: hit.map((r) => ({ ...r })), error: null }; }
    let out = rows.filter(match).slice(0, st.limit);
    if (st.head) return { data: null, count: out.length, error: null };
    if (st.single) return { data: out[0] ? { ...out[0] } : null, error: null };
    return { data: out.map((r) => ({ ...r })), error: null };
  };
  const b = {
    select(c, o) { if (st.op === "select") { st.cols = c; if (o && o.head) st.head = true; } return b; },
    insert(r) { st.op = "insert"; st.rows = Array.isArray(r) ? r : [r]; return b; },
    upsert(r) { st.op = "upsert"; st.rows = r; return b; },
    update(r) { st.op = "update"; st.rows = r; return b; },
    eq(k, v) { st.filters.push([k, "eq", v]); return b; }, in(k, v) { st.filters.push([k, "in", v]); return b; },
    is(k, v) { st.filters.push([k, "is", v]); return b; }, gte(k, v) { st.filters.push([k, "gte", v]); return b; },
    ilike() { return b; }, not() { return b; }, order() { return b; }, limit(n) { st.limit = n; return b; },
    maybeSingle() { st.single = true; return b; },
    then(res, rej) { try { res(run()); } catch (e) { rej(e); } },
  };
  return b;
}
globalThis.__fakeClient = () => ({ from: q, rpc: async () => ({ data: ++rate, error: null }), storage: { from: () => ({}) } });
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "x", BREVO_API_KEY: "k", SITE_URL: "https://subduction.art" })[k] }, serve: (h) => { globalThis.__handler = h; } };
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { if (String(u).includes("brevo")) { sent.push(JSON.parse(o.body)); return new Response("{}", { status: 201 }); } return realFetch(u, o); };

await import(join(dir, "directory/index.ts"));
const h = globalThis.__handler;
const call = async (method, body, qs = "") => { const r = await h(new Request("https://test.supabase.co/functions/v1/directory" + qs, { method, headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" }, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const wait = () => new Promise((r) => setTimeout(r, 50));
const future = (d) => new Date(Date.now() + d * 864e5).toISOString();
const ev = (id, slug, name, city) => { T.events.push({ id, slug, name, city, location_secret: false, review_status: "approved", sales_open: true, page_published_at: future(-1), starts_at: future(20), is_active: true, is_public: true }); T.ticket_nights.push({ event_id: id, starts_at: future(20), flyer_url: null }); };
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log("  ok", m); };

// 1. A show already listed when alerts go live is baseline: nobody gets an email for it.
ev("e1", "old-show", "Old Show", "Chicago, IL");
let r = await call("GET"); await wait();
ok(r.status === 200 && r.body.shows.length === 1, "GET lists the show");
ok(T.show_alert_shows.length === 1 && T.show_alert_shows[0].baseline === true, "first sweep records it as baseline");

// 2. Sign-up: bot check, bad city, good sign-up with a welcome email, no second email for the same city.
ok((await call("POST", { a: "alert", email: "fan@example.com", city: "chicago-il", city_name: "Chicago, IL", turnstile: "bad" })).status === 403, "sign-up without a bot pass is refused");
ok((await call("POST", { a: "alert", email: "fan@example.com", city: "chicago-il", city_name: "Click here, IL", turnstile: "ok" })).status === 400, "a city name that doesn't match the path is refused");
r = await call("POST", { a: "alert", email: "Fan@Example.com", city: "chicago-il", city_name: "Chicago, IL", turnstile: "ok" });
ok(r.status === 200 && r.body.city === "Chicago, IL", "sign-up saves");
ok(T.show_alerts.length === 1 && /^[0-9a-f]{64}$/.test(T.show_alerts[0].unsub_hash) && !("unsub_token" in T.show_alerts[0]) && T.show_alerts[0].ip_hash && T.show_alerts[0].ip_hash !== "1.2.3.4", "row stores a token hash and a hashed IP only");
ok(sent.length === 1 && sent[0].subject === "You're on the Chicago list" && sent[0].to[0].email === "fan@example.com", "welcome email goes out");
const tok = sent[0].textContent.match(/unalert=([0-9a-f]{64})/)[1];
ok(sent[0].headers["List-Unsubscribe"].includes("a=unalert&k=" + tok) && sent[0].headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", "welcome email has one-click unsubscribe headers");
ok(sent[0].htmlContent.includes("802 South Morris Avenue") && sent[0].textContent.includes("802 South Morris Avenue"), "welcome email has the mailing address");
await call("POST", { a: "alert", email: "fan@example.com", city: "chicago-il", city_name: "Chicago, IL", turnstile: "ok" });
ok(sent.length === 1, "signing up again sends nothing new");

// 3. A new Chicago show appears: one alert email. A Peoria show: none. Seen again: none.
ev("e2", "fault-line", "Fault Line", "Chicago, IL"); ev("e3", "peoria-night", "Peoria Night", "Peoria, IL");
await call("GET"); await wait();
const alerts = sent.slice(1);
ok(alerts.length === 1 && alerts[0].subject === "New show in Chicago: Fault Line", "one alert for the new Chicago show");
ok(alerts[0].textContent.includes("https://subduction.art/fault-line") && alerts[0].textContent.includes("unalert=" + tok), "alert has the ticket link and the same unsubscribe link");
await call("GET"); await wait();
ok(sent.length === 2, "the same show never alerts twice");
ok(T.show_alert_shows.find((s) => s.show_key.includes("fault-line")).sent_count === 1, "the show is marked sent");

// 4. One-click unsubscribe (form POST, as mail apps send it), then no more alerts.
const one = await h(new Request("https://test.supabase.co/functions/v1/directory?a=unalert&k=" + tok, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
ok(one.status === 200 && T.show_alerts[0].unsubscribed_at, "one-click unsubscribe works");
ok((await call("POST", { a: "unalert", k: "f".repeat(64) })).status === 404, "a wrong token does nothing");
ev("e4", "sub-rings", "Sub Rings", "Chicago, IL");
await call("GET"); await wait();
ok(sent.length === 2, "no alert after unsubscribing");
// 5. Coming back re-subscribes with a fresh welcome.
await call("POST", { a: "alert", email: "fan@example.com", city: "chicago-il", city_name: "Chicago, IL", turnstile: "ok" });
ok(!T.show_alerts[0].unsubscribed_at && sent.length === 3, "signing up again after leaving turns it back on");
console.log(`show alerts e2e: ${pass} checks passed`);
