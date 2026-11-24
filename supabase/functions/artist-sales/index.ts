// Artist ticket-selling: who's actually moving tickets.
// Every artist on a show gets a personal ticket link (?ref=<tag>) and a personal promo code ($0 off, it only
// credits them). Both checkouts already save ref + promo on every order, so this function only READS orders;
// it never touches checkout, tickets or emails. Self-contained on purpose (no shared imports).
//   GET ?k=<artist token>               the artist's own link, code and numbers (their pass page)
//   GET ?a=qr&k=<artist token>          a QR code of their link
//   GET ?a=staff&e=<show slug>          every artist on the show with their numbers (needs x-admin-token)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import QRCode from "npm:qrcode@1.5.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = (Deno.env.get("SITE_URL") || "https://subduction.art").replace(/\/$/, "");
const TOKEN = /^[0-9a-f]{32,64}$/;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-admin-token", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const no = (m: string, s = 400) => json({ error: m }, s);

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const base = (name: string) => (name || "artist").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 20) || "artist";

type Ev = { id: string; slug: string; name: string; company_id: string | null };
type Inv = { id: string; event_id: string; name: string; sell_ref: string | null; sell_promo_id: string | null; revoked_at: string | null };

// The public ticket page for a show. T.O.F.T.U. lives at /underground/, other original-account shows on the
// tickets page, promoter shows at subduction.art/<slug>.
async function showUrl(ev: Ev) {
  const { data: c } = ev.company_id ? await db.from("companies").select("legacy_stripe").eq("id", ev.company_id).maybeSingle() : { data: null };
  if (c?.legacy_stripe) return ev.slug === "underground" ? `${SITE}/underground/` : `${SITE}/tickets.html?e=${ev.slug}`;
  return `${SITE}/${ev.slug}`;
}
const linkFor = (url: string, ref: string) => url + (url.includes("?") ? "&" : "?") + "ref=" + encodeURIComponent(ref);

// Give an artist their link tag and code the first time anyone looks. Codes are $0 off and never run out.
async function ensure(inv: Inv): Promise<Inv> {
  if (inv.sell_ref && inv.sell_promo_id) return inv;
  const b = base(inv.name);
  let ref = inv.sell_ref, promo = inv.sell_promo_id;
  if (!ref) {
    for (let n = 0; n < 20 && !ref; n++) {
      const tryRef = n ? `${b}${n + 1}` : b;
      const { data: taken } = await db.from("artist_invites").select("id").eq("event_id", inv.event_id).ilike("sell_ref", tryRef).neq("id", inv.id).maybeSingle();
      if (!taken) ref = tryRef;
    }
    ref = ref || `${b}${inv.id.slice(0, 4)}`;
  }
  if (!promo) {
    for (let n = 0; n < 20 && !promo; n++) {
      const code = (n ? `${b}${n + 1}` : b).toUpperCase();
      const { data: existing } = await db.from("promo_codes").select("id").eq("event_id", inv.event_id).eq("code", code).maybeSingle();
      if (existing) continue;
      const { data: p } = await db.from("promo_codes").insert({ event_id: inv.event_id, code, label: `Artist: ${inv.name}`.slice(0, 80), discount_cents: 0, max_uses: null, active: true }).select("id").single();
      if (p) promo = p.id;
    }
  }
  await db.from("artist_invites").update({ sell_ref: ref, sell_promo_id: promo }).eq("id", inv.id);
  return { ...inv, sell_ref: ref, sell_promo_id: promo };
}

// Paid orders credited to each artist: their link tag OR their code. Comps and guest-list tickets never count.
async function tally(eventId: string, invs: Inv[]) {
  const { data: orders } = await db.from("ticket_orders").select("id,ref,promo_id,subtotal_cents,discount_cents").eq("event_id", eventId).eq("status", "paid").is("comp_list", null).is("artist_invite_id", null);
  const ids = (orders || []).map((o) => o.id);
  const counts: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data: t } = await db.from("tickets").select("order_id").in("order_id", ids.slice(i, i + 200));
    (t || []).forEach((r) => { counts[r.order_id] = (counts[r.order_id] || 0) + 1; });
  }
  const out: Record<string, { orders: number; tickets: number; revenue_cents: number; by_link: number; by_code: number }> = {};
  let credited = 0, all = 0;
  for (const o of orders || []) {
    all += counts[o.id] || 0;
    const viaCode = invs.find((v) => v.sell_promo_id && o.promo_id === v.sell_promo_id);
    const viaLink = invs.find((v) => v.sell_ref && o.ref && o.ref.toLowerCase() === v.sell_ref.toLowerCase());
    const who = viaCode || viaLink;   // a code typed at checkout beats a link they arrived on
    if (!who) continue;
    const s = (out[who.id] ||= { orders: 0, tickets: 0, revenue_cents: 0, by_link: 0, by_code: 0 });
    s.orders++; s.tickets += counts[o.id] || 0; s.revenue_cents += (o.subtotal_cents || 0) - (o.discount_cents || 0);
    if (viaCode) s.by_code++; else s.by_link++;
    credited += counts[o.id] || 0;
  }
  return { per: out, credited_tickets: credited, all_tickets: all };
}

async function staffCanSee(req: Request, companyId: string | null) {
  const token = (req.headers.get("x-admin-token") || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const { data: s } = await db.from("admin_sessions").select("subscriber_id,expires_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return false;
  const { data: m } = await db.from("subscribers").select("email,status").eq("id", s.subscriber_id).maybeSingle();
  if (!m || m.status === "deleted") return false;
  const { data: st } = await db.from("settings").select("value").eq("key", "admin_emails").maybeSingle();
  const admins = ((st?.value as unknown[]) || []).map((e) => String(e).toLowerCase());
  if (admins.includes(String(m.email).toLowerCase())) return true;
  if (!companyId) return false;
  const { count } = await db.from("company_staff").select("id", { count: "exact", head: true }).eq("subscriber_id", s.subscriber_id).eq("company_id", companyId);
  return (count ?? 0) > 0;
}

const INV_COLS = "id,event_id,name,sell_ref,sell_promo_id,revoked_at";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return no("Not allowed", 405);
  const u = new URL(req.url), a = u.searchParams.get("a") || "";
  try {
    if (a === "staff") {
      const slug = (u.searchParams.get("e") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
      const { data: ev } = await db.from("events").select("id,slug,name,company_id").eq("slug", slug).maybeSingle();
      if (!ev) return no("Show not found", 404);
      if (!(await staffCanSee(req, ev.company_id))) return no("Sign in again.", 401);
      const { data: rows } = await db.from("artist_invites").select(INV_COLS).eq("event_id", ev.id).is("revoked_at", null).order("created_at");
      const invs: Inv[] = [];
      for (const r of (rows || []) as Inv[]) invs.push(await ensure(r));
      const url = await showUrl(ev as Ev), t = await tally(ev.id, invs);
      const codes: Record<string, string> = {};
      const pids = invs.map((v) => v.sell_promo_id).filter(Boolean) as string[];
      if (pids.length) ((await db.from("promo_codes").select("id,code").in("id", pids)).data || []).forEach((p) => { codes[p.id] = p.code; });
      const artists = invs.map((v) => ({ id: v.id, name: v.name, link: linkFor(url, v.sell_ref!), code: v.sell_promo_id ? codes[v.sell_promo_id] || "" : "",
        ...(t.per[v.id] || { orders: 0, tickets: 0, revenue_cents: 0, by_link: 0, by_code: 0 }) }))
        .sort((x, y) => y.tickets - x.tickets || x.name.localeCompare(y.name));
      return json({ artists, credited_tickets: t.credited_tickets, all_tickets: t.all_tickets });
    }

    const k = (u.searchParams.get("k") || "").toLowerCase();
    if (!TOKEN.test(k)) return no("This link isn't valid.", 404);
    const { data: row } = await db.from("artist_invites").select(INV_COLS).eq("token", k).maybeSingle();
    if (!row || row.revoked_at) return no("This link isn't active anymore.", 404);
    const inv = await ensure(row as Inv);
    const { data: ev } = await db.from("events").select("id,slug,name,company_id").eq("id", inv.event_id).single();
    const link = linkFor(await showUrl(ev as Ev), inv.sell_ref!);
    if (a === "qr") {
      const png = await QRCode.toBuffer(link, { type: "png", width: 480, margin: 2, errorCorrectionLevel: "M" });
      return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", ...CORS } });
    }
    const { data: p } = inv.sell_promo_id ? await db.from("promo_codes").select("code").eq("id", inv.sell_promo_id).maybeSingle() : { data: null };
    const t = await tally(inv.event_id, [inv]);
    const mine = t.per[inv.id] || { orders: 0, tickets: 0, revenue_cents: 0, by_link: 0, by_code: 0 };
    return json({ show: ev?.name, link, code: p?.code || "", tickets: mine.tickets, orders: mine.orders });
  } catch (e) {
    console.error("artist-sales:", (e as Error).message);
    return no("Couldn't load that. Try again.", 500);
  }
});
