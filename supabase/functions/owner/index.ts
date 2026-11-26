// Owner's People page: one read-only view of everyone in the system, with where they came from and whose they are.
// Self-contained on purpose (no shared imports) so deploying it can never disturb the ticketing functions.
// Same staff sign-in as the Staff page: the x-admin-token header, re-checked against the staff list on every call.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { referralAdminRows } from "../_shared/referrals.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json({ error: "GET only" }, 405);
  const admin = await requireAdmin(req);
  if (!admin) return json({ error: "Sign in again." }, 401);

  const [subs, orders, tix, invites, cos, staff, events, wait, demo] = await Promise.all([
    db.from("subscribers").select("id,email,first_name,phone,zip,source,event_id,referred_by,utm_source,utm_campaign,status,email_confirmed_at,created_at").neq("status", "deleted").order("created_at", { ascending: false }).limit(10000),
    db.from("ticket_orders").select("id,event_id,company_id,status,email,name,phone,total_cents,platform_fee_cents,comp_list,ref,artist_invite_id,created_at,paid_at").in("status", ["paid", "comp"]).order("created_at", { ascending: false }).limit(10000),
    db.from("tickets").select("order_id").limit(50000),
    db.from("artist_invites").select("id,event_id,name,full_name,email,phone,guest_spots,claimed_at,revoked_at,created_at").order("created_at", { ascending: false }).limit(5000),
    db.from("companies").select("id,slug,name,status,contact_email,stripe_charges_enabled,legacy_stripe,platform_fee_cents,created_at").order("created_at", { ascending: false }).limit(1000),
    db.from("company_staff").select("company_id,subscriber_id,role").limit(5000),
    db.from("events").select("id,slug,name,company_id,starts_at").limit(2000),
    db.from("artist_waitlist").select("email,artist_name,full_name,phone,created_at").order("created_at", { ascending: false }).limit(10000),
    db.from("demo_leads").select("email,full_name,crew,phone,emailed_at,opened_at,scanned_at,created_at").order("created_at", { ascending: false }).limit(10000),
  ]);
  const bad = [subs, orders, tix, invites, cos, staff, events, wait, demo].find((r) => r.error);
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
  const promoters = (cos.data ?? []).map((c) => ({
    name: c.name, email: c.contact_email,
    people: (staff.data ?? []).filter((s) => s.company_id === c.id).map((s) => (sub.get(s.subscriber_id)?.email || "?") + " (" + s.role + ")").join(", "),
    status: c.status, payouts: c.legacy_stripe ? "Original Stripe account" : c.stripe_charges_enabled ? "Own Stripe connected" : "Stripe not connected yet",
    shows: shows[c.id] || 0, tickets_sold: sold[c.id] || 0,
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

  await db.from("engagement_events").insert({ subscriber_id: admin.id, type: "admin:people_view", meta: {} });
  // Read-only here. Marking a row paid happens in the promoter dashboard and sends no money.
  const referrals = (await referralAdminRows()) || [];
  return json({ fans, buyers, promoters, artists, waitlist, leads, referrals });
});
