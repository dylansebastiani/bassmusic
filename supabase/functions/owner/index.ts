// Owner's People page: one read-only view of everyone in the system, with where they came from and whose they are.
// Self-contained on purpose (no shared imports) so deploying it can never disturb the ticketing functions.
// Same staff sign-in as the Staff page: the x-admin-token header, re-checked against the staff list on every call.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { referralAdminRows } from "../_shared/referrals.ts";
import { brevo } from "../_shared/email/brevo.ts";
import { CONFIG } from "../_shared/config.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-admin-token",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function requireAdmin(req: Request) {
  const token = (req.headers.get("x-admin-token") || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data: s } = await db.from("admin_sessions").select("subscriber_id,expires_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  const [{ data: m }, { data: st }] = await Promise.all([
    db.from("subscribers").select("id,email,status").eq("id", s.subscriber_id).maybeSingle(),
    db.from("settings").select("value").eq("key", "admin_emails").maybeSingle(),
  ]);
  const list = (Array.isArray(st?.value) ? st!.value : []) as string[];
  if (!m || m.status === "deleted" || !list.map((e) => String(e).toLowerCase()).includes(String(m.email).toLowerCase())) return null;
  return { id: m.id as string, email: m.email as string };
}

// ---------- Staff actions: one-tap email, mark contacted, notes ----------
// Every action is logged to engagement_events (type staff:*) with the staff member as subscriber_id.
// Email goes out one at a time through Brevo as a plain personal note from Dylan, never in bulk.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SEND_KINDS = ["nudge_stripe", "invite", "pitch", "custom"];
const LOG_KINDS = ["contacted", "note", "stop"];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Only people already in the system can be emailed from here.
async function knownContact(email: string) {
  const checks = await Promise.all([
    db.from("companies").select("id").ilike("contact_email", email).limit(1),
    db.from("demo_leads").select("email").ilike("email", email).limit(1),
    db.from("artist_waitlist").select("email").ilike("email", email).limit(1),
    db.from("artist_invites").select("id").ilike("email", email).limit(1),
    db.from("ticket_orders").select("id").ilike("email", email).limit(1),
    db.from("subscribers").select("id").ilike("email", email).limit(1),
  ]);
  return checks.some((r) => (r.data ?? []).length > 0);
}
async function stopped(email: string) {
  const [{ data: sub }, { data: stop }] = await Promise.all([
    db.from("subscribers").select("status").ilike("email", email).limit(1).maybeSingle(),
    db.from("engagement_events").select("id").eq("type", "staff:stop").eq("meta->>to", email).limit(1),
  ]);
  return sub?.status === "unsubscribed" || (stop ?? []).length > 0;
}

async function post(req: Request, admin: { id: string; email: string }) {
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const to = String(b.to || "").trim().toLowerCase();
  if (!EMAIL_RE.test(to) || to.length > 254) return json({ error: "That email doesn't look right." }, 400);

  if (b.a === "log") {
    const kind = String(b.kind || "");
    if (!LOG_KINDS.includes(kind)) return json({ error: "Unknown action." }, 400);
    const text = String(b.text || "").trim().slice(0, 1000);
    if (kind === "note" && !text) return json({ error: "Write a note first." }, 400);
    const { error } = await db.from("engagement_events").insert({ subscriber_id: admin.id, type: "staff:" + kind, meta: { to, text: text || null, by: admin.email } });
    if (error) { console.error("owner log", error.message); return json({ error: "Couldn't save. Try again." }, 500); }
    return json({ ok: true });
  }

  if (b.a === "send") {
    const kind = String(b.kind || "custom");
    const subject = String(b.subject || "").trim().replace(/[\r\n]+/g, " ");
    const body = String(b.body || "").trim();
    const name = String(b.name || "").trim().slice(0, 80) || null;
    if (!SEND_KINDS.includes(kind)) return json({ error: "Unknown email." }, 400);
    if (subject.length < 2 || subject.length > 140) return json({ error: "Subject needs 2 to 140 characters." }, 400);
    if (body.length < 10 || body.length > 4000) return json({ error: "Message needs 10 to 4000 characters." }, 400);
    if (!(await knownContact(to))) return json({ error: "Only people already in Subduction can be emailed from here." }, 400);
    if (await stopped(to)) return json({ error: "They asked not to get email. Not sent." }, 409);
    // Limits: 20 an hour per staff member, and one email per person every 10 minutes.
    const hour = new Date(Date.now() - 3600e3).toISOString(), ten = new Date(Date.now() - 600e3).toISOString();
    const [{ count: mine }, { count: theirs }] = await Promise.all([
      db.from("engagement_events").select("id", { count: "exact", head: true }).eq("type", "staff:email").eq("subscriber_id", admin.id).gte("created_at", hour),
      db.from("engagement_events").select("id", { count: "exact", head: true }).eq("type", "staff:email").eq("meta->>to", to).gte("created_at", ten),
    ]);
    if ((mine ?? 0) >= 20) return json({ error: "That's 20 emails this hour. Try again later." }, 429);
    if ((theirs ?? 0) > 0) return json({ error: "They got an email from here in the last 10 minutes." }, 429);

    const addr = String(CONFIG.mailingAddress || "").trim();
    const from = Deno.env.get("FROM_EMAIL") || String(CONFIG.fromEmail || "");
    const unsub = `mailto:${from}?subject=unsubscribe`;
    const foot = `Subduction${addr && !/TBD/i.test(addr) ? " · " + addr : ""}`;
    const paras = body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
    const html = `<!doctype html><html><body style="margin:0;padding:24px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111">${paras}` +
      `<p style="margin:28px 0 0;font-size:12px;color:#777">${esc(foot)}<br><a href="${unsub}" style="color:#777">Unsubscribe</a> or reply "stop".</p></body></html>`;
    const text = `${body}\n\n--\n${foot}\nUnsubscribe: reply "stop" or email ${from}`;
    const res = await brevo.send({
      to: { email: to, name }, subject, html, text, tags: ["staff-" + kind], fromName: String(CONFIG.fromName || "Dylan @ Subduction"),
      headers: { "List-Unsubscribe": `<${unsub}>` },
    });
    await db.from("engagement_events").insert({ subscriber_id: admin.id, type: "staff:email",
      meta: { to, kind, subject, ok: res.ok, error: res.ok ? null : res.error.slice(0, 200), by: admin.email } });
    if (!res.ok) { console.error("owner send", res.status, res.error); return json({ error: "Brevo didn't send it. Try again in a minute." }, 502); }
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "GET or POST only" }, 405);
  const admin = await requireAdmin(req);
  if (!admin) return json({ error: "Sign in again." }, 401);
  if (req.method === "POST") return post(req, admin);

  const [subs, orders, tix, invites, cos, staff, events, wait, demo, types, promos] = await Promise.all([
    db.from("subscribers").select("id,email,first_name,phone,zip,source,event_id,referred_by,utm_source,utm_campaign,status,email_confirmed_at,created_at").neq("status", "deleted").order("created_at", { ascending: false }).limit(10000),
    db.from("ticket_orders").select("id,event_id,company_id,status,email,name,phone,total_cents,platform_fee_cents,comp_list,ref,promo_id,artist_invite_id,created_at,paid_at").in("status", ["paid", "comp"]).order("created_at", { ascending: false }).limit(10000),
    db.from("tickets").select("order_id,type_id,status,is_comp").limit(50000),
    db.from("artist_invites").select("id,event_id,name,full_name,email,phone,guest_spots,claimed_at,revoked_at,created_at").order("created_at", { ascending: false }).limit(5000),
    db.from("companies").select("id,slug,name,status,contact_email,stripe_charges_enabled,legacy_stripe,platform_fee_cents,created_at").order("created_at", { ascending: false }).limit(1000),
    db.from("company_staff").select("company_id,subscriber_id,role").limit(5000),
    db.from("events").select("id,slug,name,company_id,starts_at,ends_at,city").limit(2000),
    db.from("artist_waitlist").select("email,artist_name,full_name,phone,created_at").order("created_at", { ascending: false }).limit(10000),
    db.from("demo_leads").select("email,full_name,crew,phone,emailed_at,opened_at,scanned_at,created_at").order("created_at", { ascending: false }).limit(10000),
    db.from("ticket_types").select("id,event_id,slug,name,tiers,sort").limit(5000),
    db.from("promo_codes").select("id,code,label").limit(5000),
  ]);
  const bad = [subs, orders, tix, invites, cos, staff, events, wait, demo, types, promos].find((r) => r.error);
  if (bad) { console.error("owner", bad.error!.message); return json({ error: "Couldn't load. Try again." }, 500); }

  const ev = new Map((events.data ?? []).map((e) => [e.id, e]));
  const co = new Map((cos.data ?? []).map((c) => [c.id, c]));
  const sub = new Map((subs.data ?? []).map((s) => [s.id, s]));
  const showName = (id: string | null) => (id && ev.get(id)?.name) || null;
  const ownerOf = (eventId: string | null, companyId?: string | null) => {
    const c = co.get((companyId || (eventId && ev.get(eventId)?.company_id) || "") as string);
    return c ? c.name : null;
  };
  const SRC: Record<string, string> = { ig: "Instagram", tt: "TikTok", fb: "Facebook", show: "At a show", ref: "Friend link", dm: "DM", direct: "Homepage", qr: "QR sticker", guestlist: "Guest list", ticket: "Bought a ticket" };
  const count: Record<string, number> = {};
  for (const t of tix.data ?? []) count[t.order_id] = (count[t.order_id] || 0) + 1;

  const fans = (subs.data ?? []).map((s) => ({
    name: s.first_name, email: s.email, phone: s.phone, zip: s.zip,
    from: [SRC[s.source as string] || (s.source ? s.source : "Homepage"), s.referred_by && sub.get(s.referred_by) ? "invited by " + sub.get(s.referred_by)!.email : null, s.utm_campaign ? "campaign " + s.utm_campaign : null].filter(Boolean).join(" · "),
    show: showName(s.event_id), belongs_to: ownerOf(s.event_id) || "Subduction",
    status: s.status === "active" ? (s.email_confirmed_at ? "Confirmed" : "Joined") : "Unsubscribed", when: s.created_at,
  }));
  const buyers = (orders.data ?? []).map((o) => ({
    name: o.name, email: o.email, phone: o.phone,
    kind: o.artist_invite_id ? "Artist pass" : o.status === "comp" ? "Guest list" : "Bought",
    from: [o.status === "comp" && o.comp_list ? "list: " + o.comp_list : null, o.ref ? "link: " + o.ref : null].filter(Boolean).join(" · ") || (o.status === "paid" ? "Checkout" : ""),
    show: showName(o.event_id), belongs_to: ownerOf(o.event_id, o.company_id) || "Subduction",
    tickets: count[o.id] || 0, paid: o.status === "paid" ? (o.total_cents ?? 0) / 100 : 0, fee: o.status === "paid" ? (o.platform_fee_cents ?? 0) / 100 : 0,
    when: o.paid_at || o.created_at,
  }));
  const shows: Record<string, number> = {}; for (const e of events.data ?? []) if (e.company_id) shows[e.company_id] = (shows[e.company_id] || 0) + 1;
  const sold: Record<string, number> = {}; for (const b of orders.data ?? []) { const c = (b.company_id || ev.get(b.event_id)?.company_id) as string | undefined; if (c && b.status === "paid") sold[c] = (sold[c] || 0) + (count[b.id] || 0); }
  const money: Record<string, { gross: number; fees: number }> = {};
  for (const b of orders.data ?? []) {
    const c = (b.company_id || ev.get(b.event_id)?.company_id) as string | undefined;
    if (!c || b.status !== "paid") continue;
    money[c] = money[c] || { gross: 0, fees: 0 };
    money[c].gross += (b.total_cents ?? 0) / 100; money[c].fees += (b.platform_fee_cents ?? 0) / 100;
  }
  const promoters = (cos.data ?? []).map((c) => ({
    name: c.name, email: c.contact_email,
    people: (staff.data ?? []).filter((s) => s.company_id === c.id).map((s) => (sub.get(s.subscriber_id)?.email || "?") + " (" + s.role + ")").join(", "),
    status: c.status, payouts: c.legacy_stripe ? "Original Stripe account" : c.stripe_charges_enabled ? "Own Stripe connected" : "Stripe not connected yet",
    shows: shows[c.id] || 0, tickets_sold: sold[c.id] || 0, gross: money[c.id]?.gross || 0, fees: money[c.id]?.fees || 0,
    stripe: c.legacy_stripe ? "legacy" : c.stripe_charges_enabled ? "on" : "off",
    // One link per show (a show's address is its own name, not the crew's).
    link: (events.data ?? []).filter((e) => e.company_id === c.id).map((e) => "subduction.art/" + e.slug).join(", "), when: c.created_at,
  }));
  const artists = (invites.data ?? []).map((i) => ({
    name: i.name, full_name: i.full_name, email: i.email, phone: i.phone,
    show: showName(i.event_id), belongs_to: ownerOf(i.event_id) || "Subduction", guest_spots: i.guest_spots,
    status: i.revoked_at ? "Revoked" : i.claimed_at ? "Claimed pass" : "Invited", when: i.created_at,
  }));
  const waitlist = (wait.data ?? []).map((w) => ({ name: w.artist_name, full_name: w.full_name, email: w.email, phone: w.phone, from: "Artist waitlist page", when: w.created_at }));

  // Promoters who took the test ticket demo: sales leads. "Status" is how far they got.
  const leads = (demo.data ?? []).map((d) => ({ name: d.crew, full_name: d.full_name, email: d.email, phone: d.phone, from: "Demo page",
    status: d.scanned_at ? "Finished the demo" : d.opened_at ? "Opened the ticket" : d.emailed_at ? "Got the ticket" : "Signed up", when: d.created_at }));

  // Read-only here. Marking a row paid happens in the promoter dashboard and sends no money.
  const referrals = (await referralAdminRows()) || [];

  // Shows: one record per show for its workspace. Sales by day, ticket types against capacity, where sales came from.
  const promo = new Map((promos.data ?? []).map((p) => [p.id, p.code as string]));
  const day = (iso: string) => iso.slice(0, 10);
  const showList = (events.data ?? []).map((e) => {
    const os = (orders.data ?? []).filter((o) => o.event_id === e.id);
    const paidOs = os.filter((o) => o.status === "paid");
    const byDay: Record<string, number> = {};
    for (const o of paidOs) { const k = day(o.paid_at || o.created_at); byDay[k] = (byDay[k] || 0) + (count[o.id] || 0); }
    const from: Record<string, number> = {};
    for (const o of paidOs) {
      const k = o.promo_id && promo.get(o.promo_id) ? "Code " + promo.get(o.promo_id) : o.ref ? "Link " + o.ref : "Direct";
      from[k] = (from[k] || 0) + (count[o.id] || 0);
    }
    const tt = (types.data ?? []).filter((t) => t.event_id === e.id && t.slug !== "test")
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .map((t) => {
        const cap = (Array.isArray(t.tiers) ? t.tiers : []).reduce((s: number, r: { qty?: number }) => s + (Number(r?.qty) || 0), 0);
        const mine = (tix.data ?? []).filter((x) => x.type_id === t.id && x.status === "valid");
        return { name: t.name, sold: mine.filter((x) => !x.is_comp).length, comps: mine.filter((x) => x.is_comp).length, cap };
      }).filter((t) => t.sold || t.comps || t.cap);
    return {
      name: e.name, slug: e.slug, city: e.city, starts_at: e.starts_at, ends_at: e.ends_at, belongs_to: ownerOf(e.id) || "Subduction",
      link: "subduction.art/" + e.slug,
      tickets: paidOs.reduce((s, o) => s + (count[o.id] || 0), 0),
      guest_list: os.filter((o) => o.status === "comp" && !o.artist_invite_id).reduce((s, o) => s + (count[o.id] || 0), 0),
      artist_passes: os.filter((o) => o.artist_invite_id).length,
      orders: paidOs.length,
      gross: paidOs.reduce((s, o) => s + (o.total_cents ?? 0), 0) / 100,
      fees: paidOs.reduce((s, o) => s + (o.platform_fee_cents ?? 0), 0) / 100,
      by_day: Object.keys(byDay).sort().map((d) => ({ d, n: byDay[d] })),
      from: Object.entries(from).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, n]) => ({ label, n })),
      types: tt, when: e.starts_at,
    };
  }).sort((a, b) => new Date(b.starts_at || 0).getTime() - new Date(a.starts_at || 0).getTime());

  // Today: the money, the upcoming shows and the short list of things that need a person.
  // Extra counts are soft: if one fails, that line is left out and the page still loads.
  const since = (days: number) => Date.now() - days * 864e5;
  const paid = (orders.data ?? []).filter((o) => o.status === "paid");
  const sum = (rows: typeof paid, days: number, k: "total_cents" | "platform_fee_cents") =>
    rows.filter((o) => new Date(o.paid_at || o.created_at).getTime() >= since(days)).reduce((s, o) => s + (o[k] ?? 0), 0) / 100;
  const tixIn = (rows: typeof paid, days: number) =>
    rows.filter((o) => new Date(o.paid_at || o.created_at).getTime() >= since(days)).reduce((s, o) => s + (count[o.id] || 0), 0);
  const upcoming = (events.data ?? [])
    .filter((e) => e.starts_at && new Date(e.ends_at || e.starts_at).getTime() > Date.now())
    .sort((a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime())
    .slice(0, 8)
    .map((e) => {
      const mine = paid.filter((o) => o.event_id === e.id);
      return { name: e.name, slug: e.slug, city: e.city, starts_at: e.starts_at, belongs_to: ownerOf(e.id) || "Subduction",
        tickets: mine.reduce((s, o) => s + (count[o.id] || 0), 0), last7: tixIn(mine, 7),
        gross: mine.reduce((s, o) => s + (o.total_cents ?? 0), 0) / 100 };
    });
  const soft = async (q: PromiseLike<{ count: number | null; error: unknown }>) => { try { const r = await q; return r.error ? null : (r.count ?? 0); } catch { return null; } };
  const [listings, failedEmails, stuckEmails] = await Promise.all([
    soft(db.from("directory_listings").select("id", { count: "exact", head: true }).eq("status", "pending")),
    soft(db.from("email_queue").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", new Date(since(7)).toISOString())),
    soft(db.from("email_queue").select("id", { count: "exact", head: true }).eq("status", "pending").lt("send_after", new Date(Date.now() - 3600e3).toISOString())),
  ]);
  const today = {
    money: [7, 30].map((days) => ({ days, gross: sum(paid, days, "total_cents"), fees: sum(paid, days, "platform_fee_cents"), tickets: tixIn(paid, days) })),
    upcoming,
    counts: {
      leads_finished: leads.filter((l) => l.status === "Finished the demo" && new Date(l.when).getTime() >= since(30)).length,
      leads_new: leads.filter((l) => new Date(l.when).getTime() >= since(7)).length,
      waitlist_new: waitlist.filter((w) => new Date(w.when).getTime() >= since(7)).length,
      fans_new: fans.filter((f) => new Date(f.when).getTime() >= since(7)).length,
      promoters_no_stripe: promoters.filter((p) => p.status !== "suspended" && p.payouts === "Stripe not connected yet").length,
      promoters_no_show: promoters.filter((p) => p.status !== "suspended" && !p.shows).length,
      listings_waiting: listings,
      emails_failed: failedEmails,
      emails_stuck: stuckEmails,
      referrals_owed: referrals.filter((r) => r.status === "Pending").length,
    },
  };

  // Staff activity per person (emails sent, contacted, notes, stop), newest first.
  const { data: acts } = await db.from("engagement_events").select("type,meta,created_at")
    .in("type", ["staff:email", "staff:contacted", "staff:note", "staff:stop"]).order("created_at", { ascending: false }).limit(3000);
  const activity: Record<string, { type: string; text: string | null; when: string; by: string | null; ok?: boolean }[]> = {};
  for (const a of acts ?? []) {
    const m = (a.meta || {}) as Record<string, unknown>; const to = String(m.to || "");
    if (!to) continue;
    (activity[to] = activity[to] || []).push({ type: a.type.slice(6), text: (m.subject || m.text || null) as string | null, when: a.created_at, by: (m.by || null) as string | null, ok: m.ok as boolean | undefined });
  }

  await db.from("engagement_events").insert({ subscriber_id: admin.id, type: "admin:people_view", meta: {} });
  return json({ today, activity, shows: showList, fans, buyers, promoters, artists, waitlist, leads, referrals });
});
