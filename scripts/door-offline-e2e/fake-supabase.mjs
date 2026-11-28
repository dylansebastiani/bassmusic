// In-memory stand-in for supabase-js, just enough of the query builder for the door function.
// Lets the real supabase/functions/door/index.ts run locally under Deno for the offline e2e test.
// Rows are seeded from the JSON file in FAKE_SEED. ticket_scans enforces unique (ticket_id, night_id) like the real table.
const seed = JSON.parse(Deno.readTextFileSync(Deno.env.get("FAKE_SEED")));
const T = Object.assign({ events: [], ticket_nights: [], ticket_types: [], tickets: [], ticket_orders: [], ticket_scans: [], door_sessions: [], rate_limits: [], settings: [], admin_sessions: [], subscribers: [] }, seed);
const uid = () => crypto.randomUUID();
const UNIQUE = { ticket_scans: (a, b) => a.ticket_id === b.ticket_id && a.night_id === b.night_id };

class Q {
  constructor(table) { this.t = table; this.f = []; this.op = "select"; this.opts = {}; this.ord = null; this.lim = null; this.rng = null; this.one = null; }
  select(cols, o) { if (this.op === "select") this.opts = o || {}; else this.ret = true; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  neq(c, v) { this.f.push((r) => r[c] !== v); return this; }
  gt(c, v) { this.f.push((r) => r[c] > v); return this; }
  in(c, vs) { this.f.push((r) => vs.includes(r[c])); return this; }
  not(c, op, v) { this.f.push((r) => !(op === "is" && v === null ? r[c] == null : r[c] === v)); return this; }
  or(s) {
    const parts = s.split(",").map((p) => { const [c, op, ...rest] = p.split("."); return { c, op, v: rest.join(".") }; });
    this.f.push((r) => parts.some((p) => p.op === "ilike" && new RegExp("^" + p.v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i").test(String(r[p.c] ?? ""))));
    return this;
  }
  order(c, o) { this.ord = { c, asc: !o || o.ascending !== false }; return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }
  insert(rows) { this.op = "insert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(p) { this.op = "update"; this.patch = p; return this; }
  delete() { this.op = "delete"; return this; }
  run() {
    const tab = T[this.t] || (T[this.t] = []);
    if (this.op === "insert") {
      const out = [];
      for (const r of this.rows) {
        const row = { id: uid(), created_at: new Date().toISOString(), ...(this.t === "ticket_scans" ? { scanned_at: new Date().toISOString() } : {}), ...r };
        const u = UNIQUE[this.t];
        if (u && tab.some((x) => u(x, row))) return { data: null, error: { code: "23505", message: "duplicate key" } };
        tab.push(row); out.push(row);
      }
      return this.fin(out);
    }
    let rows = tab.filter((r) => this.f.every((f) => f(r)));
    if (this.op === "update") { rows.forEach((r) => Object.assign(r, this.patch)); return { data: null, error: null }; }
    if (this.op === "delete") { T[this.t] = tab.filter((r) => !rows.includes(r)); return { data: null, error: null }; }
    if (this.opts.head) return { data: null, count: rows.length, error: null };
    if (this.ord) { const { c, asc } = this.ord; rows = [...rows].sort((a, b) => (String(a[c] ?? "") < String(b[c] ?? "") ? -1 : String(a[c] ?? "") > String(b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1)); }
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    return this.fin(rows.map((r) => ({ ...r })));
  }
  fin(rows) {
    if (this.one === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "not single" } };
    if (this.one === "maybe") return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  }
  then(ok, no) { try { return Promise.resolve(this.run()).then(ok, no); } catch (e) { return Promise.reject(e).then(ok, no); } }
}
export function createClient() {
  return {
    from: (t) => new Q(t),
    rpc: async (name, args) => {
      if (name === "bump_rate_limit") { return { data: 1, error: null }; }
      return { data: null, error: null };
    },
  };
}
// Test-only peek at the tables (served by run-door.ts on /__db).
export const __tables = T;
