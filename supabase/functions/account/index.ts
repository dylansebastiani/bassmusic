// One account for everyone: fan, artist and promoter are just things an email can be, not separate sign-ups.
// Sign in once (a one-tap button by email) and the home page (/me.html) shows only what applies to you:
//   tickets you bought, shows you're on the lineup for, and crews you run or help with.
// The session is the same kind the promoter app and staff app use (stored in the browser as "stack_admin"),
// so signing in here also signs you into the promoter app. A session gives no staff powers by itself: every
// staff function still checks the staff list or the crew role on each call.
// Self-contained on purpose (no shared imports) so deploying it can never disturb the ticketing functions.
// Read-only toward orders and tickets: it never changes checkout, tickets or ticket emails.
//   POST {a:"signin", email}        email a one-tap sign-in button (same answer whether or not we know the email)
//   POST {a:"redeem", invite}       the button's link -> a session token
//   POST {a:"code", email, code}    the 6-digit code from the same email -> a session token
//   GET  ?a=me                      the home page (x-admin-token)
//   GET  ?a=crew&e=<slug>           the show hub for its crew: art + colors, share link, page checklist, numbers,
//                                   artists (pass status + sell links), playlist (x-admin-token)
//   GET  ?a=qr&e=<slug>             a QR code of the show's public link (public: it's the same link anyone can see)
//   POST {a:"profile", ...}         save your one artist profile; copied onto every show you're booked on (preview only for now)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import QRCode from "npm:qrcode@1.5.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = (Deno.env.get("SITE_URL") || "https://subduction.art").replace(/\/$/, "");
const CONTACT = "hello@subduction.art";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/, UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-admin-token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const no = (m: string, s = 400) => json({ error: m }, s);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
async function ipHash(req: Request, tag: string) {
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0.0.0.0";
  return sha256(ip + "|" + (await setting("ip_salt", "unset")) + "|" + tag);   // hashed, never stored raw
}
const LINK_HOSTS: Record<string, string[]> = {
  instagram: ["instagram.com"], soundcloud: ["soundcloud.com", "on.soundcloud.com"], spotify: ["open.spotify.com", "spotify.link"],
  tiktok: ["tiktok.com"], youtube: ["youtube.com", "youtu.be"], website: [],
};
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
function cleanLink(key: string, raw: unknown): string | null {
  let v = clean(raw, 300).replace(/\s+/g, "");
  if (!v) return null;
  if (key === "instagram" && /^@?[A-Za-z0-9._]{1,30}$/.test(v)) v = "https://instagram.com/" + v.replace(/^@/, "");
  if (key === "tiktok" && /^@?[A-Za-z0-9._]{1,30}$/.test(v)) v = "https://tiktok.com/@" + v.replace(/^@/, "");
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  let u: URL; try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.protocol = "https:";
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const ok = LINK_HOSTS[key];
  if (!ok || (ok.length && !ok.some((h) => host === h || host.endsWith("." + h)))) return null;
  return u.toString().slice(0, 300);
}
const admins = async () => ((await setting<unknown[]>("admin_emails", [])) || []).map((e) => String(e).toLowerCase());

// Who's signed in (or null). Same session table and header as the promoter and staff apps.
async function who(req: Request) {
  const token = (req.headers.get("x-admin-token") || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data: s } = await db.from("admin_sessions").select("subscriber_id,expires_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  const { data: m } = await db.from("subscribers").select("id,email,first_name,status").eq("id", s.subscriber_id).maybeSingle();
  if (!m || m.status === "deleted") return null;
  return m as { id: string; email: string; first_name: string | null; status: string };
}

// Does this email have anything here at all? (a member, a ticket, an artist spot or a crew)
async function hasAnything(email: string, memberId: string | null) {
  if (memberId) return true;
  const [{ count: o }, { count: a }] = await Promise.all([
    db.from("ticket_orders").select("id", { count: "exact", head: true }).eq("email", email).in("status", ["paid", "comp"]),
    db.from("artist_invites").select("id", { count: "exact", head: true }).ilike("email", email).is("revoked_at", null),
  ]);
  return (o ?? 0) + (a ?? 0) > 0;
}

async function sendSignin(email: string) {
  let { data: m } = await db.from("subscribers").select("id,status").eq("email", email).maybeSingle();
  if (m?.status === "deleted") return;
  if (!(await hasAnything(email, m?.id || null))) return;
  // Someone with a ticket or an artist spot but no member record yet gets one, so they have an account to sign in to.
  // Made the same way the promoter sign-up makes one (no welcome email is queued); source "account" marks where it came from.
  if (!m) m = (await db.from("subscribers").insert({ email, source: "account" }).select("id,status").single()).data;
  if (!m) return;
  // One a minute per person, so nobody can flood an inbox by typing someone else's address.
  const { data: recent } = await db.from("signin_codes").select("id").eq("subscriber_id", m.id).gte("created_at", new Date(Date.now() - 60000).toISOString()).limit(1);
  if (recent?.length) return;
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) { console.error("account: BREVO_API_KEY not set"); return; }
  const secret = hex(18), salt = await setting("ip_salt", "unset");
  // A 6-digit code rides along with the button, for when the email opens on a different device.
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const expires = new Date(Date.now() + 20 * 60000).toISOString();
  const [{ data: row }] = await Promise.all([
    db.from("signin_codes").insert({ subscriber_id: m.id, code_hash: await sha256(`${m.id}|${secret}|${salt}`), expires_at: expires }).select("id").single(),
    db.from("signin_codes").insert({ subscriber_id: m.id, code_hash: await sha256(`${m.id}|code:${code}|${salt}`), expires_at: expires }),
  ]);
  if (!row) return;
  const url = `${SITE}/me.html#invite=${row.id}.${secret}`, F = "font-family:Arial,Helvetica,sans-serif";
  const addr = String(await setting("mailing_address", "") || "");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Sign in</title></head>
<body style="margin:0;background:#0a0a0a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111110;border:1px solid #2b2927">
<tr><td style="padding:28px 24px 0;${F};font-size:26px;line-height:1.15;font-weight:bold;color:#f4f1ee">Tap to sign in</td></tr>
<tr><td style="padding:12px 24px 0;${F};font-size:15px;line-height:1.6;color:#d9d5cf">Your tickets, your shows and your crews, all in one place. No code, no password.</td></tr>
<tr><td style="padding:22px 24px 0"><a href="${url}" style="display:block;background:#b6ff00;color:#000;${F};font-size:16px;font-weight:bold;text-align:center;text-decoration:none;padding:16px 12px;text-transform:uppercase;letter-spacing:1px">Sign me in</a></td></tr>
<tr><td style="padding:20px 24px 0;${F};font-size:13px;line-height:1.5;color:#9a958f;text-align:center">Or type this code on the sign-in page:</td></tr>
<tr><td style="padding:6px 24px 0;font-family:Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:8px;color:#f4f1ee;text-align:center">${code}</td></tr>
<tr><td style="padding:18px 24px 26px;${F};font-size:12px;line-height:1.6;color:#6f6b66">Works once, for 20 minutes. Didn't ask for this? Ignore it and nothing changes.${addr && !/TBD/i.test(addr) ? "<br>" + esc(addr) : ""}</td></tr>
</table></td></tr></table></body></html>`;
  const text = ["Tap to sign in:", url, "", `Or type this code on the sign-in page: ${code}`, "", "Works once, for 20 minutes. Didn't ask for this? Ignore it and nothing changes."].join("\n");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: "Subduction", email: Deno.env.get("FROM_EMAIL") || CONTACT }, to: [{ email }], subject: `Your sign-in code: ${code}`, htmlContent: html, textContent: text, tags: ["signin"] }) });
  if (!r.ok) console.error("account: sign-in email failed", r.status, (await r.text().catch(() => "")).slice(0, 200));
}

// ---- how a show looks and where it lives ----
type Look = { link: string; image: string | null; colors: { main: string; accent: string; deep: string } };
function lookFor(ev: any, co: any): Look {
  const link = co?.legacy_stripe ? (ev.slug === "underground" ? `${SITE}/underground/` : `${SITE}/tickets.html?e=${ev.slug}`) : `${SITE}/${ev.slug}`;
  const bc = (co?.brand && co.brand.colors) || {};
  const c = ev.hub_colors || {};
  return { link, image: ev.hub_image || ev.share_url || ev.poster_url || null,
    colors: { main: c.main || bc.main || "#b6ff00", accent: c.accent || bc.accent || "#f4f1ee", deep: c.deep || bc.dark || "#1a1a1a" } };
}

// ---- the home page ----
type Night = { label: string; starts_at: string };
async function nightsFor(eventIds: string[]) {
  const out: Record<string, Night[]> = {};
  if (!eventIds.length) return out;
  const { data } = await db.from("ticket_nights").select("event_id,label,starts_at,sort").in("event_id", eventIds).order("sort");
  for (const n of data || []) (out[n.event_id] ||= []).push({ label: n.label, starts_at: n.starts_at });
  return out;
}
async function home(m: { id: string; email: string; first_name: string | null }) {
  const email = String(m.email).toLowerCase();
  const [{ data: orders }, { data: invites }, { data: staff }] = await Promise.all([
    db.from("ticket_orders").select("id,event_id,status,comp_list,artist_invite_id").eq("email", email).in("status", ["paid", "comp"]).order("created_at", { ascending: false }).limit(100),
    db.from("artist_invites").select("id,event_id,name,token,claimed_at,bio,hometown,genre,links,photo_path,sell_ref,sell_promo_id").ilike("email", email).is("revoked_at", null).order("created_at", { ascending: false }),
    db.from("company_staff").select("company_id,role").eq("subscriber_id", m.id),
  ]);
  const orderIds = (orders || []).map((o) => o.id);
  const { data: tix } = orderIds.length ? await db.from("tickets").select("order_id,event_id,type_id,code,token,status").in("order_id", orderIds).eq("status", "valid") : { data: [] };
  const eventIds = [...new Set([...(tix || []).map((t) => t.event_id), ...(invites || []).map((i) => i.event_id)])];
  const companyIds = [...new Set((staff || []).map((s) => s.company_id))];
  const [{ data: evs }, { data: types }, { data: cos }] = await Promise.all([
    eventIds.length ? db.from("events").select("id,slug,name,city,company_id").in("id", eventIds) : Promise.resolve({ data: [] as any[] }),
    (tix || []).length ? db.from("ticket_types").select("id,name").in("id", [...new Set((tix || []).map((t) => t.type_id))]) : Promise.resolve({ data: [] as any[] }),
    companyIds.length ? db.from("companies").select("id,slug,name,legacy_stripe,brand,stripe_charges_enabled").in("id", companyIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const evMap: Record<string, any> = {}; (evs || []).forEach((e: any) => { evMap[e.id] = e; });
  const tyMap: Record<string, string> = {}; (types || []).forEach((t: any) => { tyMap[t.id] = t.name; });
  // Which shows are on the original account (their tickets open on ticket.html; promoter shows on pass.html).
  const legacyCo = new Set<string>();
  const evCos = [...new Set(Object.values(evMap).map((e: any) => e.company_id).filter(Boolean))];
  if (evCos.length) ((await db.from("companies").select("id,legacy_stripe").in("id", evCos)).data || []).forEach((c) => { if (c.legacy_stripe) legacyCo.add(c.id); });
  const nights = await nightsFor(eventIds);
  const firstNight = (id: string) => (nights[id] || [])[0]?.starts_at || null;

  const ticketsByEvent: Record<string, any[]> = {};
  for (const t of tix || []) {
    const ev = evMap[t.event_id]; if (!ev) continue;
    const page = legacyCo.has(ev.company_id) ? "ticket" : "pass";
    const o = (orders || []).find((x) => x.id === t.order_id);
    const kind = o?.artist_invite_id ? "artist" : o?.status === "comp" ? "guest" : "ticket";
    (ticketsByEvent[t.event_id] ||= []).push({ type: kind === "artist" ? "Artist pass" : (tyMap[t.type_id] || "Ticket") + (kind === "guest" ? " · guest list" : ""), kind, code: t.code, url: `${SITE}/${page}.html?t=${t.token}` });
  }
  const tickets = Object.keys(ticketsByEvent).map((id) => ({ show: evMap[id].name, city: evMap[id].city, when: firstNight(id), nights: (nights[id] || []).map((n) => n.label), tickets: ticketsByEvent[id] }))
    .sort((a, b) => String(a.when).localeCompare(String(b.when)));
  // Every show they're booked on, each with its own sell link and how many tickets it has moved.
  const sold: Record<string, number> = {};
  for (const i of (invites || []).filter((x) => x.sell_ref || x.sell_promo_id)) {
    const { data: os } = await db.from("ticket_orders").select("id,ref,promo_id").eq("event_id", i.event_id).eq("status", "paid").is("comp_list", null).is("artist_invite_id", null);
    const mine = (os || []).filter((o) => (i.sell_promo_id && o.promo_id === i.sell_promo_id) || (i.sell_ref && o.ref && o.ref.toLowerCase() === String(i.sell_ref).toLowerCase())).map((o) => o.id);
    sold[i.id] = mine.length ? ((await db.from("tickets").select("id", { count: "exact", head: true }).in("order_id", mine)).count ?? 0) : 0;
  }
  const artist = (invites || []).filter((i) => evMap[i.event_id]).map((i) => ({ name: i.name, show: evMap[i.event_id].name, when: firstNight(i.event_id),
    nights: (nights[i.event_id] || []).map((n) => n.label), url: `${SITE}/artist.html?k=${i.token}`, claimed: !!i.claimed_at,
    sell_link: i.sell_ref ? `${SITE}/go/${i.sell_ref}` : null, sold: sold[i.id] || 0 }));
  // One artist profile per person. First time we see them, it's carried over from their artist pass.
  let { data: prof } = await db.from("artist_profiles").select("name,bio,hometown,genre,links,photo_path").eq("subscriber_id", m.id).maybeSingle();
  if (!prof && (invites || []).length) {
    const src = (invites || []).find((i) => i.bio || i.hometown || i.genre || i.photo_path || Object.keys(i.links || {}).length) || (invites || [])[0];
    prof = { name: src.name, bio: src.bio || null, hometown: src.hometown || null, genre: src.genre || null, links: src.links || {}, photo_path: src.photo_path || null };
    await db.from("artist_profiles").insert({ subscriber_id: m.id, ...prof });
  }
  let photo: string | null = null;
  if (prof?.photo_path) photo = (await db.storage.from("artist-photos").createSignedUrl(prof.photo_path, 3600)).data?.signedUrl || null;
  const profile = prof ? { name: prof.name, bio: prof.bio, hometown: prof.hometown, genre: prof.genre, links: prof.links || {}, photo } : null;
  const crews = (cos || []).filter((c) => companyIds.includes(c.id)).map((c) => {
    const role = (staff || []).find((s) => s.company_id === c.id)?.role || "staff";
    return { id: c.id, name: c.name, role, kind: c.legacy_stripe ? "original" : "promoter", stripe_ready: !!c.legacy_stripe || !!c.stripe_charges_enabled };
  });
  // Every crew's shows, each with its art, colors and public link (test events on the original account stay out).
  for (const c of crews) {
    const co = (cos || []).find((x) => x.id === c.id);
    let q = db.from("events").select("id,slug,name,sales_open,hub_image,hub_colors,share_url,poster_url").eq("company_id", c.id).order("created_at", { ascending: false });
    if (c.kind === "original") q = q.not("slug", "ilike", "test%");
    const { data: shows } = await q;
    const nn = await nightsFor((shows || []).map((s) => s.id));
    (c as any).shows = (shows || []).map((s) => ({ slug: s.slug, name: s.name, on_sale: !!s.sales_open, nights: (nn[s.id] || []).map((n) => n.label), ...lookFor(s, co) }));
  }
  const isStaff = (await admins()).includes(email);
  // Creating and editing artist profiles isn't open to everyone yet: staff see it to test it.
  const preview = isStaff || (await setting<boolean>("artist_profiles_open", false)) === true;
  return { email: m.email, name: m.first_name || "", staff: isStaff, tickets, artist, profile, artist_preview: preview, crews, music: `${SITE}/collection.html`, demo: `${SITE}/demo.html`, waitlist: `${SITE}/artists.html` };
}

// ---- a show's numbers for its crew (read-only) ----
async function crew(m: { id: string; email: string }, slug: string, token = "") {
  const { data: ev } = await db.from("events").select("id,slug,name,company_id,artist_milestone,sales_open,venue,city,address,location_secret,age,hub_image,hub_colors,share_url,poster_url,playlist,page_published_at").eq("slug", slug).maybeSingle();
  if (!ev) return null;
  const isStaff = (await admins()).includes(String(m.email).toLowerCase());
  if (!isStaff) {
    const { data: row } = await db.from("company_staff").select("role").eq("subscriber_id", m.id).eq("company_id", ev.company_id).maybeSingle();
    if (!row) return null;
  }
  // Make sure every artist has a sell link and code (the artist sales tracker creates them the first time it's asked).
  if (token) { try { await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/artist-sales?a=staff&e=${encodeURIComponent(slug)}`, { headers: { "x-admin-token": token }, signal: AbortSignal.timeout(8000) }); } catch { /* the hub still loads */ } }
  const [{ data: orders }, { data: types }, nights] = await Promise.all([
    db.from("ticket_orders").select("id,status,name,email,phone,ref,promo_id,subtotal_cents,discount_cents,comp_list,artist_invite_id,paid_at,created_at").eq("event_id", ev.id).in("status", ["paid", "comp"]),
    db.from("ticket_types").select("id,name,sort,on_sale,tiers").eq("event_id", ev.id).order("sort"),
    nightsFor([ev.id]),
  ]);
  const ids = (orders || []).map((o) => o.id);
  const tix: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("tickets").select("id,order_id,type_id,is_comp,status,holder_name").in("order_id", ids.slice(i, i + 200)).eq("status", "valid");
    tix.push(...(data || []));
  }
  const paidOrders = new Set((orders || []).filter((o) => o.status === "paid" && !o.comp_list && !o.artist_invite_id).map((o) => o.id));
  // Per ticket type: sold, guest list, and its tier ladder (for the ticket meter: how full each tier is).
  const byType = (types || []).map((t) => {
    const sold = tix.filter((x) => x.type_id === t.id && !x.is_comp && paidOrders.has(x.order_id)).length;
    const comps = tix.filter((x) => x.type_id === t.id && (x.is_comp || !paidOrders.has(x.order_id))).length;
    const tiers = (Array.isArray(t.tiers) ? t.tiers : []).map((x: any) => ({ name: x.name, qty: x.qty || 0, price_cents: x.price_cents ?? 0 }));
    return { name: t.name, on_sale: !!t.on_sale, sold, comps, cap: tiers.reduce((a: number, x: any) => a + x.qty, 0), tiers };
  });
  const sold = byType.reduce((a, t) => a + t.sold, 0), comps = byType.reduce((a, t) => a + t.comps, 0);
  const money = (orders || []).filter((o) => paidOrders.has(o.id)).reduce((a, o) => a + (o.subtotal_cents || 0) - (o.discount_cents || 0), 0);
  // Last 7 days, a sale count per day, for a quick "is it moving" read.
  const days: { day: string; tickets: number }[] = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const dayOrders = new Set((orders || []).filter((o) => paidOrders.has(o.id) && String(o.paid_at || "").slice(0, 10) === day).map((o) => o.id));
    days.push({ day, tickets: tix.filter((x) => dayOrders.has(x.order_id)).length });
  }
  // Artists selling: same rules as the artist sales tracker (their link tag or their $0 code).
  const { data: invs } = await db.from("artist_invites").select("id,name,sell_ref,sell_promo_id,claimed_at,email,phone").eq("event_id", ev.id).is("revoked_at", null).order("created_at");
  const { data: clicks } = (invs || []).length ? await db.from("artist_clicks").select("invite_id").in("invite_id", (invs || []).map((v) => v.id)).limit(20000) : { data: [] };
  const artists = (invs || []).map((v) => {
    let t = 0;
    for (const o of orders || []) {
      if (!paidOrders.has(o.id)) continue;
      const mine = (v.sell_promo_id && o.promo_id === v.sell_promo_id) || (v.sell_ref && o.ref && o.ref.toLowerCase() === v.sell_ref.toLowerCase());
      if (mine) t += tix.filter((x) => x.order_id === o.id).length;
    }
    return { name: v.name, tickets: t, taps: (clicks || []).filter((c) => c.invite_id === v.id).length, link: v.sell_ref ? `${SITE}/go/${v.sell_ref}` : null,
      claimed: !!v.claimed_at, has_email: !!v.email, has_phone: !!v.phone };
  }).sort((a, b) => b.tickets - a.tickets || b.taps - a.taps || a.name.localeCompare(b.name));
  const { data: co } = await db.from("companies").select("legacy_stripe,brand,stripe_charges_enabled").eq("id", ev.company_id).maybeSingle();
  const look = lookFor(ev, co);
  // What's on sale right now, at what price (the current tier of each ticket type).
  const prices = (types || []).filter((t) => t.on_sale && Array.isArray(t.tiers) && t.tiers.length).map((t) => {
    const taken = tix.filter((x) => x.type_id === t.id).length;
    let start = 0, cur: any = null;
    for (const tier of t.tiers as any[]) { const end = start + (tier.qty || 0); if (!cur && taken < end) cur = { ...tier, left: end - taken }; start = end; }
    return { name: t.name, tier: cur?.name || "Sold out", price_cents: cur?.price_cents ?? null, left: cur?.left ?? 0 };
  });
  const { count: artistTracks } = await db.from("playlist_tracks").select("id", { count: "exact", head: true }).eq("event_id", ev.id);
  // The full guest list and every buyer, with who's checked in at the door.
  const scanned = new Set<string>();
  for (let i = 0; i < tix.length; i += 200) {
    const { data: sc } = await db.from("ticket_scans").select("ticket_id").in("ticket_id", tix.slice(i, i + 200).map((x) => x.id));
    (sc || []).forEach((r) => scanned.add(r.ticket_id));
  }
  const tyName: Record<string, string> = {}; (types || []).forEach((t) => { tyName[t.id] = t.name; });
  const people = (orders || []).map((o) => {
    const mine = tix.filter((x) => x.order_id === o.id);
    const kinds: Record<string, number> = {}; mine.forEach((x) => { const n = tyName[x.type_id] || "Ticket"; kinds[n] = (kinds[n] || 0) + 1; });
    return { name: o.name || mine[0]?.holder_name || "", email: o.email || "", phone: o.phone || "", tickets: mine.length,
      what: Object.entries(kinds).map(([n, q]) => (q > 1 ? q + "× " : "") + n).join(", "), checked_in: mine.filter((x) => scanned.has(x.id)).length,
      list: o.artist_invite_id ? "Artist" : o.status === "comp" ? (o.comp_list || "Guest list") : "", when: o.paid_at || o.created_at, paid: paidOrders.has(o.id) };
  }).filter((p) => p.tickets > 0);
  const guests = people.filter((p) => !p.paid).sort((a, b) => (a.list === "Artist" ? 0 : 1) - (b.list === "Artist" ? 0 : 1) || a.name.localeCompare(b.name));
  const buyers = people.filter((p) => p.paid).sort((a, b) => String(b.when).localeCompare(String(a.when)));
  const pl = (ev.playlist || {}) as { mode?: string; tracks?: unknown[] };
  // A quick "is everything right?" list for the promoter.
  const nightList = nights[ev.id] || [];
  const checks = [
    { label: "Tickets on sale", ok: !!ev.sales_open },
    { label: "Prices set", ok: prices.length > 0 },
    { label: "Dates and doors", ok: nightList.length > 0 && nightList.every((n) => !!n.starts_at) },
    { label: ev.location_secret ? "Secret location (address sent before the show)" : "Venue address", ok: ev.location_secret || !!ev.address },
    { label: "Every artist has their pass", ok: artists.length > 0 && artists.every((a) => a.claimed) },
    { label: "Show playlist", ok: (artistTracks ?? 0) > 0 || (pl.tracks || []).length > 0 || pl.mode === "subduction" },
  ];
  return { show: ev.name, slug: ev.slug, ...look, nights: nightList.map((n) => n.label), venue: ev.location_secret ? "Secret location" : ev.venue, city: ev.city, age: ev.age,
    on_sale: !!ev.sales_open, sold, comps, money_cents: money, by_type: byType, prices, last7: days, artists, checks,
    playlist: { mode: pl.mode || "subduction", tracks: (pl.tracks || []).length, artist_tracks: artistTracks ?? 0 },
    guests: guests.map(({ paid, ...g }) => g), buyers: buyers.map(({ paid, list, ...b }) => b) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url);
  try {
    if (req.method === "POST") {
      let b: Record<string, unknown>; try { b = await req.json(); } catch { return no("Bad request"); }
      if (b.a === "signin") {
        const email = String(b.email || "").trim().toLowerCase().slice(0, 254);
        if (!EMAIL_RE.test(email)) return no("That email doesn't look right.");
        const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, "account") });
        if ((n ?? 0) > 6) return no("Too many tries. Wait a minute and try again.", 429);
        await sendSignin(email);
        return json({ sent: true });   // same answer either way, so this can't be used to find out who's here
      }
      if (b.a === "code") {
        const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, "account-code") });
        if ((n ?? 0) > 10) return no("Too many tries. Wait a minute.", 429);
        const email = String(b.email || "").trim().toLowerCase().slice(0, 254), code = String(b.code || "").replace(/\D/g, "");
        const bad = () => no("That code didn't work. Check it, or send a new one.");
        if (!EMAIL_RE.test(email) || code.length !== 6) return bad();
        const { data: m } = await db.from("subscribers").select("id,email,status").eq("email", email).maybeSingle();
        if (!m || m.status === "deleted") return bad();
        const { data: rows } = await db.from("signin_codes").select("id,code_hash,attempts").eq("subscriber_id", m.id).is("used_at", null)
          .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(6);
        const live = (rows || []).filter((r) => r.attempts < 5);
        if (!live.length) return bad();
        const want = await sha256(`${m.id}|code:${code}|${await setting("ip_salt", "unset")}`);
        const hit = live.find((r) => r.code_hash === want);
        // A wrong guess counts against every open code for this email (5 wrong and they're all dead).
        if (!hit) { await Promise.all(live.map((r) => db.from("signin_codes").update({ attempts: r.attempts + 1 }).eq("id", r.id))); return bad(); }
        await db.from("signin_codes").update({ used_at: new Date().toISOString() }).eq("id", hit.id);
        const token = hex(32);
        await db.from("admin_sessions").insert({ subscriber_id: m.id, token_hash: await sha256(token), expires_at: new Date(Date.now() + 30 * 86400000).toISOString() });
        return json({ token, email: m.email });
      }
      if (b.a === "redeem") {
        const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, "account-redeem") });
        if ((n ?? 0) > 10) return no("Too many tries. Wait a minute.", 429);
        const [id, secret] = String(b.invite || "").split(".");
        const bad = () => no("That link has expired or was already used. Enter your email to get a new one.");
        if (!UUID_RE.test(id || "") || !/^[0-9a-f]{36}$/.test(secret || "")) return bad();
        const { data: c } = await db.from("signin_codes").select("id,subscriber_id,code_hash,expires_at,attempts,used_at").eq("id", id).maybeSingle();
        if (!c || c.used_at || new Date(c.expires_at).getTime() < Date.now() || c.attempts >= 5) return bad();
        if (c.code_hash !== await sha256(`${c.subscriber_id}|${secret}|${await setting("ip_salt", "unset")}`)) { await db.from("signin_codes").update({ attempts: c.attempts + 1 }).eq("id", c.id); return bad(); }
        await db.from("signin_codes").update({ used_at: new Date().toISOString() }).eq("id", c.id);
        const { data: m } = await db.from("subscribers").select("id,email,status").eq("id", c.subscriber_id).maybeSingle();
        if (!m || m.status === "deleted") return bad();
        const token = hex(32);
        await db.from("admin_sessions").insert({ subscriber_id: m.id, token_hash: await sha256(token), expires_at: new Date(Date.now() + 30 * 86400000).toISOString() });
        return json({ token, email: m.email });
      }
      if (b.a === "profile") {
        const me = await who(req);
        if (!me) return no("Sign in again.", 401);
        const email = String(me.email).toLowerCase();
        const preview = (await admins()).includes(email) || (await setting<boolean>("artist_profiles_open", false)) === true;
        if (!preview) return no("Artist profiles are coming soon.", 403);
        const name = clean(b.name, 60);
        if (!name) return no("Add your artist name.");
        const typed = (b.links && typeof b.links === "object" ? b.links : {}) as Record<string, unknown>;
        const links: Record<string, string> = {};
        for (const k of Object.keys(LINK_HOSTS)) { const v = cleanLink(k, typed[k]); if (v) links[k] = v; }
        const bad = Object.keys(LINK_HOSTS).filter((k) => clean(typed[k], 300) && !links[k]);
        if (bad.length) return no("Check your " + bad.join(" and ") + " link. Paste the full address from the app.");
        const patch = { bio: clean(b.bio, 400) || null, hometown: clean(b.hometown, 60) || null, genre: clean(b.genre, 60) || null, links };
        const { data: cur } = await db.from("artist_profiles").select("photo_path").eq("subscriber_id", me.id).maybeSingle();
        await db.from("artist_profiles").upsert({ subscriber_id: me.id, name, ...patch, photo_path: cur?.photo_path || null, updated_at: new Date().toISOString() }, { onConflict: "subscriber_id" });
        // Copy onto every show they're booked on. The billing name on each show stays the promoter's.
        await db.from("artist_invites").update(patch).ilike("email", email).is("revoked_at", null);
        return json({ saved: true });
      }
      return no("Bad request");
    }
    if (req.method !== "GET") return no("Not allowed", 405);
    if (u.searchParams.get("a") === "qr") {
      const slug = (u.searchParams.get("e") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
      const { data: ev } = await db.from("events").select("slug,company_id").eq("slug", slug).maybeSingle();
      if (!ev) return no("Not found", 404);
      const { data: co } = await db.from("companies").select("legacy_stripe").eq("id", ev.company_id).maybeSingle();
      const png = await QRCode.toBuffer(lookFor(ev, co).link, { type: "png", width: 480, margin: 2, errorCorrectionLevel: "M" });
      return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", ...CORS } });
    }
    const m = await who(req);
    if (!m) return no("Sign in again.", 401);
    const a = u.searchParams.get("a") || "";
    if (a === "me") return json(await home(m));
    if (a === "crew") {
      const r = await crew(m, (u.searchParams.get("e") || "").toLowerCase().replace(/[^a-z0-9-]/g, ""), (req.headers.get("x-admin-token") || "").trim());
      return r ? json(r) : no("Not found", 404);
    }
    return no("Bad request");
  } catch (e) {
    console.error("account:", (e as Error).message);
    return no("Couldn't load that. Try again.", 500);
  }
});
