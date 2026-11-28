// Artist ticket-selling: who's actually moving tickets.
// Every artist on a show gets a short link (subduction.art/go/<tag>) and a personal promo code ($0 off, it only
// credits them). Both checkouts already save ref + promo on every order, so this function only READS orders;
// it never touches checkout, tickets or ticket emails. Self-contained on purpose (no shared imports).
//   GET  ?go=<tag>                      short link: count the tap, then send them to the show with ?ref=<tag>
//   GET  ?k=<artist token>              the artist's own link, code and count (their pass page)
//   GET  ?a=qr&k=<artist token>         a QR code of their short link
//   GET  ?a=alerts-off&k=<token>        turn off "you sold one" emails (link in every alert)
//   GET  ?a=refs                        short-link tags, so the site build can give each a real page. The build sends x-build-key (BUILD_REFS_KEY) and gets all of them; anyone else only gets approved, non-hands-off shows, no secret acts
//   GET  ?a=staff&e=<show slug>         every artist on the show with numbers (x-admin-token)
//                                       plus the show's tracked links (flyers, posters) with scans + sales
//   POST ?a=link {e, label}             staff: make a tracked link (subduction.art/go/<tag>) for a flyer etc.
//   POST ?a=milestone {e, n}            staff-only milestone for a show (x-admin-token, owner of the show)
//   POST ?a=notify                      cron (x-runner-secret): email artists about newly credited sales
// Milestones are staff-only. Nothing about them is ever shown or sent to an artist.
import { ipFromHeaders } from "../_shared/client_ip.mjs";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import QRCode from "npm:qrcode@1.5.4";
import { publicRefs } from "./refs.mjs";
import { sameSecret } from "../_shared/secret.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = (Deno.env.get("SITE_URL") || "https://subduction.art").replace(/\/$/, "");
const FN = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/artist-sales";
const TOKEN = /^[0-9a-f]{32,64}$/, TAG = /^[a-z0-9]{1,24}$/;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-admin-token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const no = (m: string, s = 400) => json({ error: m }, s);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
const base = (name: string) => (name || "artist").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 20) || "artist";
const short = (tag: string) => `${SITE}/go/${tag}`;

type Ev = { id: string; slug: string; name: string; company_id: string | null };
type Inv = { id: string; event_id: string; name: string; sell_ref: string | null; sell_promo_id: string | null; revoked_at: string | null };
type Stat = { orders: number; tickets: number; revenue_cents: number; by_link: number; by_code: number; order_ids: { id: string; tickets: number; paid_at: string | null }[] };
const blank = (): Stat => ({ orders: 0, tickets: 0, revenue_cents: 0, by_link: 0, by_code: 0, order_ids: [] });

// The public ticket page for a show. T.O.F.T.U. lives at /underground/, other original-account shows on the
// tickets page, promoter shows at subduction.art/<slug>.
async function showUrl(ev: Ev) {
  const { data: c } = ev.company_id ? await db.from("companies").select("legacy_stripe").eq("id", ev.company_id).maybeSingle() : { data: null };
  if (c?.legacy_stripe) return ev.slug === "underground" ? `${SITE}/underground/` : `${SITE}/tickets.html?e=${ev.slug}`;
  return `${SITE}/${ev.slug}`;
}
const linkFor = (url: string, ref: string) => url + (url.includes("?") ? "&" : "?") + "ref=" + encodeURIComponent(ref);

// Give an artist their tag and code the first time anyone looks. Tags are unique across every show, so a short
// link always means exactly one artist on one show. Codes are $0 off and never run out.
async function ensure(inv: Inv): Promise<Inv> {
  if (inv.sell_ref && inv.sell_promo_id) return inv;
  const b = base(inv.name);
  let ref = inv.sell_ref, promo = inv.sell_promo_id;
  if (!ref) {
    for (let n = 0; n < 30 && !ref; n++) {
      const tryRef = n ? `${b}${n + 1}` : b;
      const { data: taken } = await db.from("artist_invites").select("id").ilike("sell_ref", tryRef).neq("id", inv.id).limit(1);
      const { data: tl } = await db.from("track_links").select("id").ilike("tag", tryRef).limit(1);
      if (!taken?.length && !tl?.length) ref = tryRef;
    }
    ref = ref || `${b}${inv.id.replace(/-/g, "").slice(0, 4)}`;
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
  const { data: orders } = await db.from("ticket_orders").select("id,ref,promo_id,subtotal_cents,discount_cents,paid_at").eq("event_id", eventId).eq("status", "paid").is("comp_list", null).is("artist_invite_id", null);
  const ids = (orders || []).map((o) => o.id);
  const counts: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data: t } = await db.from("tickets").select("order_id").in("order_id", ids.slice(i, i + 200));
    (t || []).forEach((r) => { counts[r.order_id] = (counts[r.order_id] || 0) + 1; });
  }
  const per: Record<string, Stat> = {};
  let credited = 0, all = 0;
  for (const o of orders || []) {
    const n = counts[o.id] || 0;
    all += n;
    const viaCode = invs.find((v) => v.sell_promo_id && o.promo_id === v.sell_promo_id);
    const viaLink = invs.find((v) => v.sell_ref && o.ref && o.ref.toLowerCase() === v.sell_ref.toLowerCase());
    const who = viaCode || viaLink;   // a code typed at checkout beats a link they arrived on
    if (!who) continue;
    const s = (per[who.id] ||= blank());
    s.orders++; s.tickets += n; s.revenue_cents += (o.subtotal_cents || 0) - (o.discount_cents || 0);
    if (viaCode) s.by_code++; else s.by_link++;
    s.order_ids.push({ id: o.id, tickets: n, paid_at: o.paid_at });
    credited += n;
  }
  return { per, credited_tickets: credited, all_tickets: all };
}

// Taps on each artist's short link: every tap, and distinct phones (hashed network address per day).
async function clicks(inviteIds: string[]) {
  const out: Record<string, { clicks: number; people: number }> = {};
  if (!inviteIds.length) return out;
  const { data } = await db.from("artist_clicks").select("invite_id,ip_hash,created_at").in("invite_id", inviteIds).limit(20000);
  const seen: Record<string, Set<string>> = {};
  for (const r of data || []) {
    const o = (out[r.invite_id] ||= { clicks: 0, people: 0 });
    o.clicks++;
    const key = (r.ip_hash || "") + "|" + String(r.created_at).slice(0, 10);
    (seen[r.invite_id] ||= new Set()).add(key);
  }
  for (const id in seen) out[id].people = seen[id].size;
  return out;
}

// Tracked links (flyers, posters...): scans, distinct phones, and paid orders that arrived through them.
type TL = { id: string; tag: string; label: string; created_at: string };
async function linkStats(eventId: string, links: TL[]) {
  if (!links.length) return [];
  const { data: cl } = await db.from("track_clicks").select("link_id,ip_hash,created_at").in("link_id", links.map((l) => l.id)).limit(50000);
  const taps: Record<string, number> = {}, seen: Record<string, Set<string>> = {};
  for (const r of cl || []) { taps[r.link_id] = (taps[r.link_id] || 0) + 1; (seen[r.link_id] ||= new Set()).add((r.ip_hash || "") + "|" + String(r.created_at).slice(0, 10)); }
  const tags = links.map((l) => l.tag.toLowerCase());
  const { data: orders } = await db.from("ticket_orders").select("id,ref,subtotal_cents,discount_cents").eq("event_id", eventId).eq("status", "paid").is("comp_list", null).not("ref", "is", null);
  const mine = (orders || []).filter((o) => tags.includes(String(o.ref).toLowerCase()));
  const counts: Record<string, number> = {};
  const ids = mine.map((o) => o.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data: t } = await db.from("tickets").select("order_id").in("order_id", ids.slice(i, i + 200));
    (t || []).forEach((r) => { counts[r.order_id] = (counts[r.order_id] || 0) + 1; });
  }
  return links.map((l) => {
    const os = mine.filter((o) => String(o.ref).toLowerCase() === l.tag.toLowerCase());
    return { id: l.id, label: l.label, tag: l.tag, link: short(l.tag), qr: `${FN}?a=lqr&t=${l.tag}`,
      taps: taps[l.id] || 0, people: seen[l.id]?.size || 0, orders: os.length,
      tickets: os.reduce((n, o) => n + (counts[o.id] || 0), 0),
      revenue_cents: os.reduce((n, o) => n + (o.subtotal_cents || 0) - (o.discount_cents || 0), 0) };
  }).sort((a, b) => b.tickets - a.tickets || b.taps - a.taps);
}

// Who's asking from the staff app: "admin" (platform staff), "owner"/"staff" of the show's crew, or null.
async function staffRole(req: Request, companyId: string | null): Promise<"admin" | "owner" | "staff" | null> {
  const token = (req.headers.get("x-admin-token") || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data: s } = await db.from("admin_sessions").select("subscriber_id,expires_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  const { data: m } = await db.from("subscribers").select("email,status").eq("id", s.subscriber_id).maybeSingle();
  if (!m || m.status === "deleted") return null;
  const admins = ((await setting<unknown[]>("admin_emails", [])) || []).map((e) => String(e).toLowerCase());
  if (admins.includes(String(m.email).toLowerCase())) return "admin";
  if (!companyId) return null;
  const { data: row } = await db.from("company_staff").select("role").eq("subscriber_id", s.subscriber_id).eq("company_id", companyId).maybeSingle();
  return row ? (row.role === "owner" ? "owner" : "staff") : null;
}

// Preview robots get a tiny page instead of the redirect: the event page's own preview tags (read live from the
// event page), but with og:url = the short link, so tapping the bubble comes back through /go/<tag> and keeps credit.
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// Legacy shows live on tickets.html?e=<slug>, whose raw HTML carries T.O.F.T.U.'s hardcoded tags (the browser
// rewrites them later). Never scrape those; build the preview from the show's own row instead.
async function dbPreview(evId: string, fallbackTitle: string): Promise<[string, string][]> {
  const { data: d } = await db.from("events").select("name,venue,city,starts_at,location_secret,share_url,poster_url").eq("id", evId).maybeSingle();
  const name = d?.name || fallbackTitle;
  let when = "";
  if (d?.starts_at) { try { when = new Date(d.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" }); } catch { /* skip the date */ } }
  const where = d?.location_secret ? d?.city : [d?.venue, d?.city].filter(Boolean).join(", ");
  const desc = [when, where].filter(Boolean).join(" · ");
  const image = d?.share_url || d?.poster_url;
  const tags: [string, string][] = [["og:title", name]];
  if (desc) tags.push(["og:description", desc]);
  if (image) tags.push(["og:image", image], ["twitter:card", "summary_large_image"]);
  return tags;
}
async function previewPage(eventPage: string, canonical: string, fallbackTitle: string, evId: string) {
  let tags: [string, string][] = [];
  const legacy = /\/tickets\.html\?(?:[^#]*&)?e=/i.test(eventPage);
  try {
    if (legacy) tags = await dbPreview(evId, fallbackTitle);
    else {
      const r = await fetch(eventPage, { headers: { "user-agent": "stack-preview/1" }, signal: AbortSignal.timeout(4000) });
      const html = r.ok ? (await r.text()).slice(0, 200000) : "";
      // Attribute values may be double- or single-quoted.
      const attr = (tag: string, n: string) => { const m = new RegExp(`(?:^|[\\s"'])${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag); return m ? (m[1] ?? m[2]) : undefined; };
      for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
        const prop = attr(m[0], "property") ?? attr(m[0], "name");
        const content = attr(m[0], "content");
        if (prop && /^(og|twitter):/i.test(prop) && content !== undefined && prop.toLowerCase() !== "og:url") tags.push([prop.toLowerCase(), unesc(content)]);
      }
    }
  } catch { /* fall back to the show name below */ }
  if (!tags.some(([p]) => p === "og:title")) tags.push(["og:title", fallbackTitle]);
  const title = tags.find(([p]) => p === "og:title")![1];
  const meta = [["og:url", canonical] as [string, string], ...tags].map(([p, c]) => `<meta property="${esc(p)}" content="${esc(c)}">`).join("\n");
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>\n<link rel="canonical" href="${esc(canonical)}">\n${meta}\n</head><body><a href="${esc(canonical)}">${esc(title)}</a></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

// ---- "You sold one" email ----
async function senderFor(ev: Ev) {
  const { data: c } = ev.company_id ? await db.from("companies").select("name,legacy_stripe").eq("id", ev.company_id).maybeSingle() : { data: null };
  if (c?.legacy_stripe) return Deno.env.get("TICKETS_FROM_NAME") || "T.O.F.T.U. Tickets";
  return `${c?.name || "Your show"} Tickets`.slice(0, 70);
}
async function sendAlert(to: string, artist: string, ev: Ev, fresh: number, total: number, link: string, code: string, token: string) {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) { console.error("artist-sales: BREVO_API_KEY not set"); return false; }
  const F = "font-family:Arial,Helvetica,sans-serif", GOLD = "#F2C14E";
  const addr = String(await setting("mailing_address", "") || "");
  const off = `${FN}?a=alerts-off&k=${token}`;
  const head = fresh === 1 ? "You just sold a ticket" : `You just sold ${fresh} tickets`;
  const subject = `${head}: ${ev.name}`.slice(0, 120);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#050505"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0d0a12;border:1px solid #3B1760">
<tr><td style="padding:26px 24px 4px;${F};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${GOLD}">${esc(ev.name)}</td></tr>
<tr><td style="padding:0 24px;${F};font-size:28px;line-height:1.15;font-weight:bold;color:#ffffff">${esc(head)}</td></tr>
<tr><td style="padding:12px 24px 0;${F};font-size:15px;line-height:1.6;color:#D9D2E3">${esc(artist)}, that's <b style="color:#fff">${total} ${total === 1 ? "ticket" : "tickets"}</b> sold through your link and code so far. Keep it going.</td></tr>
<tr><td style="padding:18px 24px 0;${F};font-size:13px;line-height:1.7;color:#9b8fb0">Your link: <a href="${esc(link)}" style="color:${GOLD}">${esc(link.replace(/^https?:\/\//, ""))}</a>${code ? `<br>Your code: <b style="color:#fff;letter-spacing:2px">${esc(code)}</b>` : ""}</td></tr>
<tr><td style="padding:20px 24px 0"><a href="${esc(link)}" style="display:block;background:${GOLD};color:#050505;${F};font-size:15px;font-weight:bold;text-align:center;text-decoration:none;padding:15px 12px;text-transform:uppercase;letter-spacing:1px">Share your link again</a></td></tr>
<tr><td style="padding:22px 24px 26px;${F};font-size:12px;line-height:1.6;color:#6f6b66">You get these because you're on the lineup. <a href="${esc(off)}" style="color:#9b8fb0">Turn off sales alerts</a>.${addr && !/TBD/i.test(addr) ? "<br>" + esc(addr) : ""}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`${head}: ${ev.name}`, "", `${artist}, that's ${total} ${total === 1 ? "ticket" : "tickets"} sold through your link and code so far.`, "",
    `Your link: ${link}`, code ? `Your code: ${code}` : "", "", `Turn off sales alerts: ${off}`].filter((l, i, a) => l || a[i - 1]).join("\n");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: await senderFor(ev), email: Deno.env.get("FROM_EMAIL") || "hello@subduction.art" }, to: [{ email: to, name: artist }],
      subject, htmlContent: html, textContent: text, tags: ["artist-sale"] }) });
  if (!r.ok) { console.error("artist-sales: alert failed", r.status, (await r.text().catch(() => "")).slice(0, 200)); return false; }
  return true;
}

async function notify() {
  const { data: rows } = await db.from("artist_invites").select("id,event_id,name,sell_ref,sell_promo_id,revoked_at,email,token,sales_alerts").is("revoked_at", null).not("sell_ref", "is", null);
  const byEvent: Record<string, any[]> = {};
  for (const r of rows || []) (byEvent[r.event_id] ||= []).push(r);
  let sent = 0;
  for (const eventId in byEvent) {
    const invs = byEvent[eventId];
    const t = await tally(eventId, invs);
    const credited = Object.values(t.per).flatMap((s) => s.order_ids.map((o) => o.id));
    if (!credited.length) continue;
    const { data: done } = await db.from("artist_sale_alerts").select("order_id").in("order_id", credited);
    const doneSet = new Set((done || []).map((d) => d.order_id));
    const { data: ev } = await db.from("events").select("id,slug,name,company_id").eq("id", eventId).single();
    const url = await showUrl(ev as Ev);
    for (const inv of invs) {
      const s = t.per[inv.id];
      if (!s) continue;
      const fresh = s.order_ids.filter((o) => !doneSet.has(o.id));
      if (!fresh.length) continue;
      // Claim these orders first, so two runs can never email the same sale twice.
      const { data: claimed } = await db.from("artist_sale_alerts").upsert(fresh.map((o) => ({ order_id: o.id, invite_id: inv.id })), { onConflict: "order_id", ignoreDuplicates: true }).select("order_id");
      const mine = new Set((claimed || []).map((c) => c.order_id));
      // Only sales from the last day get an email; anything older is marked done quietly.
      const recent = fresh.filter((o) => mine.has(o.id) && o.paid_at && Date.now() - new Date(o.paid_at).getTime() < 86400000);
      const n = recent.reduce((a, o) => a + o.tickets, 0);
      if (!n || !inv.sales_alerts || !inv.email) continue;
      const { data: p } = inv.sell_promo_id ? await db.from("promo_codes").select("code").eq("id", inv.sell_promo_id).maybeSingle() : { data: null };
      if (await sendAlert(inv.email, inv.name, ev as Ev, n, s.tickets, short(inv.sell_ref), p?.code || "", inv.token)) {
        sent++;
        await db.from("artist_sale_alerts").update({ sent_at: new Date().toISOString() }).in("order_id", recent.map((o) => o.id));
      }
    }
  }
  return sent;
}

const INV_COLS = "id,event_id,name,sell_ref,sell_promo_id,revoked_at";
const page = (title: string, body: string) => new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;background:#050505;color:#fff;font:16px/1.6 Arial,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px"><div><h1 style="font-size:24px">${esc(title)}</h1><p style="color:#bbb">${body}</p></div></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url), a = u.searchParams.get("a") || "";
  try {
    // ---- cron: alerts ----
    if (req.method === "POST" && a === "notify") {
      const secret = await setting<string | null>("runner_secret", null);
      if (!sameSecret(req.headers.get("x-runner-secret"), secret)) return no("Not allowed", 401);
      return json({ sent: await notify() });
    }
    // ---- staff: milestone ----
    if (req.method === "POST" && a === "milestone") {
      let b: Record<string, unknown>; try { b = await req.json(); } catch { return no("Bad request"); }
      const slug = String(b.e || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
      const { data: ev } = await db.from("events").select("id,company_id").eq("slug", slug).maybeSingle();
      if (!ev) return no("Show not found", 404);
      const role = await staffRole(req, ev.company_id);
      if (role !== "admin" && role !== "owner") return no("Only the show's owner can set this.", 403);
      const n = Math.floor(Number(b.n));
      await db.from("events").update({ artist_milestone: n > 0 && n < 10000 ? n : null }).eq("id", ev.id);
      return json({ milestone: n > 0 && n < 10000 ? n : null });
    }
    if (a === "link" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const slug = String(b.e || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
      const { data: ev } = await db.from("events").select("id,company_id").eq("slug", slug).maybeSingle();
      if (!ev) return no("Show not found", 404);
      if (!(await staffRole(req, ev.company_id))) return no("Sign in again.", 401);
      const label = String(b.label || "").trim().slice(0, 60);
      if (!label) return no("Name the link, e.g. Handbills or Poster at Kuma's.");
      const root = base(label).slice(0, 18);
      for (let n = 0; n < 30; n++) {
        const tag = n ? `${root}${n + 1}` : root;
        const { data: t1 } = await db.from("track_links").select("id").ilike("tag", tag).limit(1);
        const { data: t2 } = await db.from("artist_invites").select("id").ilike("sell_ref", tag).limit(1);
        if (t1?.length || t2?.length) continue;
        const { error } = await db.from("track_links").insert({ event_id: ev.id, tag, label });
        if (!error) return json({ tag, link: short(tag) });
      }
      return no("Couldn't make that link. Try another name.");
    }
    if (req.method !== "GET") return no("Not allowed", 405);

    // ---- QR code for a tracked link (public: it only encodes the public short link) ----
    if (a === "lqr") {
      const t = (u.searchParams.get("t") || "").toLowerCase();
      if (!TAG.test(t)) return no("Not found", 404);
      const png = await QRCode.toBuffer(short(t), { type: "png", width: 1200, margin: 2, errorCorrectionLevel: "Q" });
      return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Content-Disposition": `inline; filename="qr-${t}.png"`, "Cache-Control": "public, max-age=3600", ...CORS } });
    }

    // ---- short link: count the tap, then forward ----
    const go = (u.searchParams.get("go") || "").toLowerCase();
    if (go) {
      if (!TAG.test(go)) return Response.redirect(SITE, 302);
      const ipRaw = ipFromHeaders((h: string) => req.headers.get(h));
      const ua = req.headers.get("user-agent") || "";
      // Link-preview robots (iMessage, Instagram, Facebook...) open links too; they don't count as taps.
      const human = !/bot|crawl|spider|preview|facebookexternalhit|slackbot|whatsapp|telegram|discord|twitterbot|linkedin|embedly|curl|wget/i.test(ua);
      const { data: inv } = await db.from("artist_invites").select(INV_COLS).ilike("sell_ref", go).is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (inv) {
        const { data: ev } = await db.from("events").select("id,slug,name,company_id").eq("id", inv.event_id).single();
        if (!human) return previewPage(await showUrl(ev as Ev), short(inv.sell_ref!), (ev as Ev).name, (ev as Ev).id);
        await db.from("artist_clicks").insert({ invite_id: inv.id, ip_hash: await sha256(ipRaw + "|" + (await setting("ip_salt", "unset")) + "|go") });
        return new Response(null, { status: 302, headers: { Location: linkFor(await showUrl(ev as Ev), inv.sell_ref!), "Cache-Control": "no-store" } });
      }
      // Not an artist: a tracked link (flyer, poster, handbill...).
      const { data: tl } = await db.from("track_links").select("id,event_id,tag").ilike("tag", go).is("revoked_at", null).limit(1).maybeSingle();
      if (!tl) return Response.redirect(SITE, 302);
      const { data: ev } = await db.from("events").select("id,slug,name,company_id").eq("id", tl.event_id).single();
      if (!human) return previewPage(await showUrl(ev as Ev), short(tl.tag), (ev as Ev).name, (ev as Ev).id);
      await db.from("track_clicks").insert({ link_id: tl.id, ip_hash: await sha256(ipRaw + "|" + (await setting("ip_salt", "unset")) + "|go") });
      return new Response(null, { status: 302, headers: { Location: linkFor(await showUrl(ev as Ev), tl.tag), "Cache-Control": "no-store" } });
    }

    // The site build sends BUILD_REFS_KEY and gets every tag, exactly as before, so every existing /go/ page still builds.
    // Anyone else gets only tags for approved, non-hands-off shows, with secret acts left out.
    if (a === "refs") {
      const { data } = await db.from("artist_invites").select("sell_ref,name,event_id").is("revoked_at", null).not("sell_ref", "is", null);
      const { data: tls } = await db.from("track_links").select("tag,event_id").is("revoked_at", null);
      const key = Deno.env.get("BUILD_REFS_KEY") || "";
      const sent = req.headers.get("x-build-key") || "";
      if (key && sameSecret(key, sent)) {
        return json({ refs: [...(data || []).map((r) => r.sell_ref), ...(tls || []).map((r) => r.tag)].filter((r) => TAG.test(r)), full: true });
      }
      const ids = [...new Set([...(data || []), ...(tls || [])].map((r) => r.event_id).filter(Boolean))];
      const { data: evs } = ids.length ? await db.from("events").select("id,slug,review_status,company_id").in("id", ids) : { data: [] };
      const cids = [...new Set((evs || []).map((e) => e.company_id).filter(Boolean))];
      const { data: cos } = cids.length ? await db.from("companies").select("id,slug,legacy_stripe").in("id", cids) : { data: [] };
      const { data: lns } = ids.length ? await db.from("ticket_nights").select("event_id,lineup_full").in("event_id", ids) : { data: [] };
      const secretActs: Record<string, string[]> = {};
      for (const n of lns || []) for (const act of Array.isArray(n.lineup_full) ? n.lineup_full : []) if (act?.secret) (secretActs[n.event_id] ||= []).push(String(act.name || "").trim().toLowerCase());
      return json({ refs: publicRefs({ invites: data || [], links: tls || [], events: Object.fromEntries((evs || []).map((e) => [e.id, e])),
        companies: Object.fromEntries((cos || []).map((c) => [c.id, c])), secretActs }) });
    }

    if (a === "staff") {
      const slug = (u.searchParams.get("e") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
      const { data: ev } = await db.from("events").select("id,slug,name,company_id,artist_milestone").eq("slug", slug).maybeSingle();
      if (!ev) return no("Show not found", 404);
      const role = await staffRole(req, ev.company_id);
      if (!role) return no("Sign in again.", 401);
      const { data: rows } = await db.from("artist_invites").select(INV_COLS).eq("event_id", ev.id).is("revoked_at", null).order("created_at");
      const invs: Inv[] = [];
      for (const r of (rows || []) as Inv[]) invs.push(await ensure(r));
      const [t, c] = [await tally(ev.id, invs), await clicks(invs.map((v) => v.id))];
      const codes: Record<string, string> = {};
      const pids = invs.map((v) => v.sell_promo_id).filter(Boolean) as string[];
      if (pids.length) ((await db.from("promo_codes").select("id,code").in("id", pids)).data || []).forEach((p) => { codes[p.id] = p.code; });
      const m = ev.artist_milestone || null;
      const artists = invs.map((v) => {
        const s = t.per[v.id] || blank();
        return { id: v.id, name: v.name, link: short(v.sell_ref!), code: v.sell_promo_id ? codes[v.sell_promo_id] || "" : "",
          orders: s.orders, tickets: s.tickets, revenue_cents: s.revenue_cents, by_link: s.by_link, by_code: s.by_code,
          clicks: c[v.id]?.clicks || 0, people: c[v.id]?.people || 0, milestone_hit: !!m && s.tickets >= m };
      }).sort((x, y) => y.tickets - x.tickets || y.clicks - x.clicks || x.name.localeCompare(y.name));
      const { data: tlr } = await db.from("track_links").select("id,tag,label,created_at").eq("event_id", ev.id).is("revoked_at", null).order("created_at");
      const links = await linkStats(ev.id, (tlr || []) as TL[]);
      return json({ artists, links, credited_tickets: t.credited_tickets, all_tickets: t.all_tickets, milestone: m, can_set_milestone: role === "admin" || role === "owner" });
    }

    // ---- the artist's own view ----
    const k = (u.searchParams.get("k") || "").toLowerCase();
    if (!TOKEN.test(k)) return no("This link isn't valid.", 404);
    const { data: row } = await db.from("artist_invites").select(INV_COLS).eq("token", k).maybeSingle();
    if (!row || row.revoked_at) return no("This link isn't active anymore.", 404);
    if (a === "alerts-off") {
      await db.from("artist_invites").update({ sales_alerts: false }).eq("id", row.id);
      return page("Sales alerts are off", "You won't get any more sale emails for this show. Your link and code still work, and your count is still on your artist page.");
    }
    const inv = await ensure(row as Inv);
    const link = short(inv.sell_ref!);
    if (a === "qr") {
      const png = await QRCode.toBuffer(link, { type: "png", width: 480, margin: 2, errorCorrectionLevel: "M" });
      return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", ...CORS } });
    }
    const { data: ev } = await db.from("events").select("name").eq("id", inv.event_id).single();
    const { data: p } = inv.sell_promo_id ? await db.from("promo_codes").select("code").eq("id", inv.sell_promo_id).maybeSingle() : { data: null };
    const t = await tally(inv.event_id, [inv]);
    const mine = t.per[inv.id] || blank();
    return json({ show: ev?.name, link, code: p?.code || "", tickets: mine.tickets, orders: mine.orders });
  } catch (e) {
    console.error("artist-sales:", (e as Error).message);
    return no("Couldn't load that. Try again.", 500);
  }
});
