// One account for everyone: fan, artist and promoter are just things an email can be, not separate sign-ups.
// Sign in once (a one-tap button by email) and the home page (/me.html) shows only what applies to you:
//   tickets you bought, shows you're on the lineup for, and crews you run or help with.
// The session is the same kind the promoter app and staff app use (stored in the browser as "stack_admin"),
// so signing in here also signs you into the promoter app. A session gives no staff powers by itself: every
// staff function still checks the staff list or the crew role on each call.
// Self-contained on purpose (no shared imports) so deploying it can never disturb the ticketing functions.
// Read-only toward orders and tickets: it never changes checkout, tickets or ticket emails.
//   POST {a:"signin", email, turnstile}  email a one-tap sign-in button. A new email gets an account (source "account", no welcome
//                                   email). Bot check + 3 a minute per IP. Same answer whether or not we know the email
//   POST {a:"redeem", invite}       the button's link -> a session token
//   POST {a:"code", email, code}    the 6-digit code from the same email -> a session token
//   POST {a:"member", key}          a fan's member key -> a session token (refused for crew, staff, admins and artists; 24h session without tickets). 10 a minute per IP
//   GET  ?a=me                   the home page (x-admin-token)
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
  const ip = (req.headers.get("cf-connecting-ip") || "").split(",")[0].trim() || "no-ip";
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
  const { data: s } = await db.from("admin_sessions").select("subscriber_id,expires_at,created_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  const { data: m } = await db.from("subscribers").select("id,email,first_name,status").eq("id", s.subscriber_id).maybeSingle();
  if (!m || m.status === "deleted") return null;
  // Sessions made from a fan's member key last 24 hours (email sign-ins last 30 days), so a short one is the lower-trust kind.
  const limited = new Date(s.expires_at).getTime() - new Date(s.created_at).getTime() <= 2 * 86400000;
  return { ...m, limited } as { id: string; email: string; first_name: string | null; status: string; limited: boolean };
}

// Bot check for sign-in (Cloudflare Turnstile). Inline on purpose: this file imports nothing from _shared.
// No TURNSTILE_SECRET set means refuse (fail closed) and log it.
async function botCheck(token: unknown, ip: string) {
  const secret = Deno.env.get("TURNSTILE_SECRET");
  if (!secret) { console.error("account: TURNSTILE_SECRET is not set, so every sign-in bot check is refused. Set it in the function secrets."); return false; }
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token, remoteip: ip }),
    signal: AbortSignal.timeout(10_000),
  }).then((x) => x.json()).catch(() => ({ success: false }));
  const hosts = (Deno.env.get("TURNSTILE_HOSTNAMES") || "subduction.art,www.subduction.art").split(",").map((h) => h.trim()).filter(Boolean);
  return r.success === true && r.action === "signup" && hosts.includes(r.hostname);
}

async function sendSignin(email: string) {
  let { data: m } = await db.from("subscribers").select("id,status").eq("email", email).maybeSingle();
  if (m?.status === "deleted") return;
  // Anyone with a valid email gets an account, so they have something to sign in to.
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
<tr><td style="padding:12px 24px 0;${F};font-size:15px;line-height:1.6;color:#d9d5cf">Use the button or the code below to sign in.</td></tr>
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
type Night = { id: string; label: string; starts_at: string; capacity: number | null };
async function nightsFor(eventIds: string[]) {
  const out: Record<string, Night[]> = {};
  if (!eventIds.length) return out;
  const { data } = await db.from("ticket_nights").select("id,event_id,label,starts_at,sort,capacity").in("event_id", eventIds).order("sort");
  for (const n of data || []) (out[n.event_id] ||= []).push({ id: n.id, label: n.label, starts_at: n.starts_at, capacity: n.capacity ?? null });
  return out;
}
async function home(m: { id: string; email: string; first_name: string | null; limited?: boolean }) {
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
    const kind = o?.artist_invite_id && (!o.comp_list || o.comp_list === "Artist") ? "artist" : o?.status === "comp" ? "guest" : "ticket";
    (ticketsByEvent[t.event_id] ||= []).push({ type: kind === "artist" ? "Artist pass" : (tyMap[t.type_id] || "Ticket") + (kind === "guest" ? " · guest list" : ""), kind, code: t.code, url: `${SITE}/${page}.html?t=${t.token}` });
  }
  let tickets = Object.keys(ticketsByEvent).map((id) => ({ show: evMap[id].name, city: evMap[id].city, when: firstNight(id), nights: (nights[id] || []).map((n) => n.label), tickets: ticketsByEvent[id] }))
    .sort((a, b) => String(a.when).localeCompare(String(b.when)));
  // Every show they're booked on, each with its own sell link and how many tickets it has moved.
  // A booked artist with no link yet gets one the same way their pass page does: by asking artist-sales, which
  // makes the tag and code. Nothing here touches checkout, tickets or the webhook.
  const needLink = (invites || []).filter((i) => (!i.sell_ref || !i.sell_promo_id) && evMap[i.event_id]);
  if (needLink.length) {
    await Promise.all(needLink.map((i) => fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/artist-sales?k=${i.token}`, { signal: AbortSignal.timeout(8000) }).catch(() => null)));
    const { data: fresh } = await db.from("artist_invites").select("id,sell_ref,sell_promo_id").in("id", needLink.map((i) => i.id));
    for (const f of fresh || []) { const i = (invites || []).find((x) => x.id === f.id); if (i) { i.sell_ref = f.sell_ref; i.sell_promo_id = f.sell_promo_id; } }
  }
  // Same rules as artist-sales tally(): paid only, no comps or artist passes, ref matched without case, and a code
  // typed at checkout beats the link, so one order is credited to one artist across everyone on the show.
  const sold: Record<string, number> = {}, codes: Record<string, string> = {};
  const pids = (invites || []).map((i) => i.sell_promo_id).filter(Boolean) as string[];
  if (pids.length) ((await db.from("promo_codes").select("id,code").in("id", pids)).data || []).forEach((p) => { codes[p.id] = p.code; });
  for (const evId of [...new Set((invites || []).filter((x) => x.sell_ref || x.sell_promo_id).map((x) => x.event_id))]) {
    const [{ data: os }, { data: all }] = await Promise.all([
      db.from("ticket_orders").select("id,ref,promo_id").eq("event_id", evId).eq("status", "paid").is("comp_list", null).is("artist_invite_id", null),
      db.from("artist_invites").select("id,sell_ref,sell_promo_id").eq("event_id", evId).is("revoked_at", null),
    ]);
    const credit: Record<string, string[]> = {};
    for (const o of os || []) {
      const who = (all || []).find((v) => v.sell_promo_id && o.promo_id === v.sell_promo_id) || (all || []).find((v) => v.sell_ref && o.ref && o.ref.toLowerCase() === String(v.sell_ref).toLowerCase());
      if (who) (credit[who.id] ||= []).push(o.id);
    }
    for (const i of (invites || []).filter((x) => x.event_id === evId)) {
      const ids = credit[i.id] || []; let n = 0;
      for (let k = 0; k < ids.length; k += 200) n += (await db.from("tickets").select("id", { count: "exact", head: true }).in("order_id", ids.slice(k, k + 200))).count ?? 0;
      sold[i.id] = n;
    }
  }
  let artist = (invites || []).filter((i) => evMap[i.event_id]).map((i) => ({ name: i.name, show: evMap[i.event_id].name, when: firstNight(i.event_id),
    nights: (nights[i.event_id] || []).map((n) => n.label), url: `${SITE}/artist.html?k=${i.token}`, claimed: !!i.claimed_at,
    sell_link: i.sell_ref ? `${SITE}/go/${i.sell_ref}` : null, code: i.sell_promo_id ? codes[i.sell_promo_id] || "" : "", sold: sold[i.id] || 0 }));
  // A member-key session is lower trust: no ticket links, ticket codes or artist pass links until they sign in with their email.
  if (m.limited) {
    tickets = tickets.map((g) => ({ ...g, tickets: [] }));
    artist = artist.map((a) => ({ ...a, url: null as any, sell_link: null, code: "" }));
  }
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
    // Tickets sold per show for the cards (paid only: no comps, no test tickets) and the night capacity.
    const ids = (shows || []).map((s) => s.id), soldBy: Record<string, number> = {};
    // Read-only face-price breakdown for promoter crews: paid orders only, no comps, no test or artist types, each ticket's own unit_cents.
    const byPrice: Record<string, Record<number, number>> = {};
    if (ids.length) {
      const [{ data: tt }, { data: sold }] = await Promise.all([
        db.from("ticket_types").select("id,slug").in("event_id", ids).in("slug", ["test", "artist"]),
        db.from("tickets").select("order_id,event_id,type_id,unit_cents").in("event_id", ids).eq("status", "valid").eq("is_comp", false),
      ]);
      const test = new Set((tt || []).filter((t) => t.slug === "test").map((t) => t.id));
      const skip = new Set((tt || []).map((t) => t.id));
      (sold || []).forEach((x) => { if (!test.has(x.type_id)) soldBy[x.event_id] = (soldBy[x.event_id] || 0) + 1; });
      if ((c.kind === "promoter" && c.role === "owner")) {
        const rows = (sold || []).filter((x) => !skip.has(x.type_id));
        const oids = [...new Set(rows.map((x) => x.order_id))] as string[], paidO = new Set<string>();
        for (let i = 0; i < oids.length; i += 200) {
          const { data: po } = await db.from("ticket_orders").select("id").in("id", oids.slice(i, i + 200)).eq("status", "paid");
          (po || []).forEach((o) => paidO.add(o.id));
        }
        rows.forEach((x) => { if (!paidO.has(x.order_id)) return; const h = (byPrice[x.event_id] ||= {}), k = Math.max(0, Math.round(Number(x.unit_cents) || 0)); h[k] = (h[k] || 0) + 1; });
      }
    }
    const salesOf = (id: string) => { const by = Object.entries(byPrice[id] || {}).map(([k, n]) => [Number(k), n] as [number, number]);
      return { count: by.reduce((t, [, n]) => t + n, 0), face_cents: by.reduce((t, [k, n]) => t + k * n, 0), by_price: by }; };
    (c as any).shows = (shows || []).map((s) => ({ slug: s.slug, name: s.name, on_sale: !!s.sales_open, nights: (nn[s.id] || []).map((n) => n.label),
      sold: soldBy[s.id] || 0, ...((c.kind === "promoter" && c.role === "owner") ? { sales: salesOf(s.id) } : {}), cap: Math.max(0, ...(nn[s.id] || []).map((n) => n.capacity || 0)) || null, ...lookFor(s, co) }));
  }
  const isStaff = (await admins()).includes(email);
  // Creating and editing artist profiles isn't open to everyone yet: staff see it to test it.
  const preview = isStaff || (await setting<boolean>("artist_profiles_open", false)) === true;
  return { email: m.email, name: m.first_name || "", staff: isStaff, tickets, artist, profile, artist_preview: preview, crews, limited: !!m.limited, tickets_note: m.limited ? "Sign in with your email to open your tickets" : null, music: `${SITE}/collection.html`, demo: `${SITE}/demo.html`, waitlist: `${SITE}/artists.html` };
}

// ---- a show's numbers for its crew (read-only) ----
async function crew(m: { id: string; email: string }, slug: string, token = "") {
  const { data: ev } = await db.from("events").select("id,slug,name,company_id,artist_milestone,sales_open,venue,city,address,location_secret,age,hub_image,hub_colors,share_url,poster_url,playlist,page_published_at,door_pin_hash").eq("slug", slug).maybeSingle();
  if (!ev) return null;
  const isStaff = (await admins()).includes(String(m.email).toLowerCase());
  let canAdd = isStaff;
  if (!isStaff) {
    const { data: row } = await db.from("company_staff").select("role").eq("subscriber_id", m.id).eq("company_id", ev.company_id).maybeSingle();
    if (!row) return null;
    canAdd = row.role === "owner";
  }
  // Make sure every artist has a sell link and code (the artist sales tracker creates them the first time it's asked).
  if (token) { try { await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/artist-sales?a=staff&e=${encodeURIComponent(slug)}`, { headers: { "x-admin-token": token }, signal: AbortSignal.timeout(8000) }); } catch { /* the hub still loads */ } }
  const [{ data: orders }, { data: types }, nights] = await Promise.all([
    db.from("ticket_orders").select("id,status,name,email,phone,ref,promo_id,subtotal_cents,discount_cents,comp_list,artist_invite_id,paid_at,created_at,created_by").eq("event_id", ev.id).in("status", ["paid", "comp"]),
    db.from("ticket_types").select("id,name,sort,on_sale,tiers,night_ids").eq("event_id", ev.id).order("sort"),
    nightsFor([ev.id]),
  ]);
  const ids = (orders || []).map((o) => o.id);
  const tix: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("tickets").select("id,order_id,type_id,is_comp,status,holder_name").in("order_id", ids.slice(i, i + 200)).eq("status", "valid");
    tix.push(...(data || []));
  }
  // One clear model for every count on this page:
  //   sold   = a paid ticket someone bought
  //   artist = an artist's own pass
  //   guest  = a comp: someone on the promoter's list or an artist's list
  //   test   = anything on a "test" ticket type or the "Test" list; left out of every count
  const tyName: Record<string, string> = {}; (types || []).forEach((t) => { tyName[t.id] = t.name; });
  const orderOf: Record<string, any> = {}; (orders || []).forEach((o) => { orderOf[o.id] = o; });
  const kindOf = (x: any): "sold" | "artist" | "guest" | "test" => {
    const o = orderOf[x.order_id] || {};
    if (/test/i.test(tyName[x.type_id] || "") || /^test$/i.test(o.comp_list || "")) return "test";
    if (o.artist_invite_id && (!o.comp_list || o.comp_list === "Artist")) return "artist";
    if (o.status === "paid" && !o.comp_list && !o.artist_invite_id && !x.is_comp) return "sold";
    return "guest";
  };
  tix.forEach((x) => { x.kind = kindOf(x); });
  const real = tix.filter((x) => x.kind !== "test");
  const paidOrders = new Set(real.filter((x) => x.kind === "sold").map((x) => x.order_id));
  // Per ticket type: sold and guests, against its tier ladder (for the ticket meter).
  const byType = (types || []).filter((t) => !/test/i.test(t.name)).map((t) => {
    const mine = real.filter((x) => x.type_id === t.id);
    const tiers = (Array.isArray(t.tiers) ? t.tiers : []).map((x: any) => ({ name: x.name, qty: x.qty || 0, price_cents: x.price_cents ?? 0 }));
    return { name: t.name, on_sale: !!t.on_sale, sold: mine.filter((x) => x.kind === "sold").length, guests: mine.filter((x) => x.kind === "guest").length,
      artists: mine.filter((x) => x.kind === "artist").length, cap: tiers.reduce((a: number, x: any) => a + x.qty, 0), tiers };
  });
  const sold = real.filter((x) => x.kind === "sold").length;
  const artistPasses = real.filter((x) => x.kind === "artist").length, guestCount = real.filter((x) => x.kind === "guest").length;
  const tests = tix.length - real.length;
  const money = (orders || []).filter((o) => paidOrders.has(o.id)).reduce((a, o) => a + (o.subtotal_cents || 0) - (o.discount_cents || 0), 0);
  // Last 7 days: tickets sold per day.
  const days: { day: string; tickets: number }[] = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    days.push({ day, tickets: real.filter((x) => x.kind === "sold" && String(orderOf[x.order_id]?.paid_at || "").slice(0, 10) === day).length });
  }
  // One meter per night. Only sold tickets fill a night; a 2-day pass fills one spot on each of its nights.
  // Capacity comes from the night (set per show); if it isn't set, fall back to the one-night tickets' total.
  // What each ticket costs right now, from the same rule the checkout uses.
  const nowPrices = await Promise.all((types || []).filter((t) => t.on_sale && !/test/i.test(t.name) && t.name !== "Artist Pass").map(async (t) => {
    const { data: cq } = await db.rpc("capped_quote", { p_type: t.id });
    if (cq) return { name: t.name, sold_out: !!(cq as any).sold_out, tier: (cq as any).tier?.name || "", price_cents: (cq as any).tier?.price_cents ?? 0, left_at_price: (cq as any).tier?.left ?? 0, left: (cq as any).left ?? 0 };
    const bt = byType.find((b) => b.name === t.name)!; let start = 0, cur: any = null, at = 0;
    for (const x of bt.tiers) { const end = start + x.qty; if (!cur && bt.sold < end) { cur = x; at = end - bt.sold; } start = end; }
    return { name: t.name, sold_out: !cur, tier: cur?.name || "", price_cents: cur?.price_cents ?? 0, left_at_price: at, left: Math.max(0, bt.cap - bt.sold) };
  }));
  const nightMeters = (nights[ev.id] || []).map((n) => {
    const covers = (types || []).filter((t) => !/test/i.test(t.name) && (t.night_ids || []).includes(n.id));
    const fallback = covers.filter((t) => (t.night_ids || []).length === 1).reduce((a, t) => a + (Array.isArray(t.tiers) ? t.tiers : []).reduce((b: number, x: any) => b + (x.qty || 0), 0), 0);
    const parts = covers.map((t) => ({ name: t.name, sold: real.filter((x) => x.type_id === t.id && x.kind === "sold").length })).filter((p) => p.sold > 0);
    const inNight = real.filter((x) => covers.some((t) => t.id === x.type_id));
    return { label: n.label, cap: n.capacity || fallback, sold: parts.reduce((a, p) => a + p.sold, 0), parts,
      guests: inNight.filter((x) => x.kind === "guest").length, artists: inNight.filter((x) => x.kind === "artist").length };
  });
  // Artists selling: same rules as the artist sales tracker (their link tag or their $0 code).
  const { data: invs } = await db.from("artist_invites").select("id,name,sell_ref,sell_promo_id,claimed_at,email,phone,photo_path,created_by").eq("event_id", ev.id).is("revoked_at", null).order("created_at");
  // Each artist's own photo (from their pass page), signed for an hour.
  const photos: Record<string, string> = {};
  const paths = (invs || []).map((v) => v.photo_path).filter(Boolean) as string[];
  if (paths.length) {
    const { data: signed } = await db.storage.from("artist-photos").createSignedUrls(paths, 3600);
    (signed || []).forEach((x: any) => { if (x.path && x.signedUrl) photos[x.path] = x.signedUrl; });
  }
  const { data: clicks } = (invs || []).length ? await db.from("artist_clicks").select("invite_id").in("invite_id", (invs || []).map((v) => v.id)).limit(20000) : { data: [] };
  const { data: memRows } = (invs || []).length
    ? await db.from("artist_members").select("id,invite_id,full_name").in("invite_id", (invs || []).map((v) => v.id)).is("revoked_at", null).order("created_at")
    : { data: [] as { id: string; invite_id: string; full_name: string }[] };
  const artists = (invs || []).map((v) => {
    let t = 0;
    for (const o of orders || []) {
      if (!paidOrders.has(o.id)) continue;
      const mine = (v.sell_promo_id && o.promo_id === v.sell_promo_id) || (v.sell_ref && o.ref && o.ref.toLowerCase() === v.sell_ref.toLowerCase());
      if (mine) t += tix.filter((x) => x.order_id === o.id).length;
    }
    return { id: canAdd && (isStaff || v.created_by === m.id) ? v.id : "", name: v.name, tickets: t,
      members: (memRows || []).filter((x) => x.invite_id === v.id).map((x) => ({ id: x.id, name: x.full_name })), taps: (clicks || []).filter((c) => c.invite_id === v.id).length, link: v.sell_ref ? `${SITE}/go/${v.sell_ref}` : null,
      claimed: !!v.claimed_at, has_email: !!v.email, has_phone: !!v.phone, photo: (v.photo_path && photos[v.photo_path]) || null };
  }).sort((a, b) => b.tickets - a.tickets || b.taps - a.taps || a.name.localeCompare(b.name));
  const { data: co } = await db.from("companies").select("legacy_stripe,brand,stripe_charges_enabled").eq("id", ev.company_id).maybeSingle();
  // The lineup draft (what staff publish), only for people who can edit it.
  const { data: lnights } = canAdd ? await db.from("ticket_nights").select("id,label,lineup,lineup_full,sort").eq("event_id", ev.id).order("sort") : { data: null };
  const lineup = (lnights || []).map((n) => ({ id: n.id, label: n.label, acts: (n.lineup_full ?? n.lineup ?? []) as { name: string; note?: string }[],
    public: Array.isArray(n.lineup) && n.lineup.length > 0 }));
  const look = lookFor(ev, co);
  // What's on sale right now, at what price (the current tier of each ticket type).
  const prices = (types || []).filter((t) => t.on_sale && Array.isArray(t.tiers) && t.tiers.length).map((t) => {
    const taken = real.filter((x) => x.type_id === t.id).length;
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
  const people = (orders || []).map((o) => {
    const mine = real.filter((x) => x.order_id === o.id);
    const kinds: Record<string, number> = {}; mine.forEach((x) => { const n = tyName[x.type_id] || "Ticket"; kinds[n] = (kinds[n] || 0) + 1; });
    // Which nights this person can get in (for the door list).
    const nset = new Set<string>(); mine.forEach((x) => ((types || []).find((t) => t.id === x.type_id)?.night_ids || []).forEach((id: string) => nset.add(id)));
    return { name: o.name || mine[0]?.holder_name || "", email: o.email || "", phone: o.phone || "", tickets: mine.length, kind: mine[0]?.kind || "",
      stage: o.artist_invite_id && (!o.comp_list || o.comp_list === "Artist") ? (invs || []).find((v) => v.id === o.artist_invite_id)?.name || "" : "",
      // Promoter-list guests can be removed from the hub; artists' guests are the artist's to manage.
      order_id: o.status === "comp" && !o.artist_invite_id && (isStaff || o.created_by === m.id) ? o.id : "",
      nights: (nights[ev.id] || []).filter((n) => nset.has(n.id)).map((n) => n.label),
      what: Object.entries(kinds).map(([n, q]) => (q > 1 ? q + "× " : "") + n).join(", "), checked_in: mine.filter((x) => scanned.has(x.id)).length,
      // Whose list a guest is on: an artist's ("Guest of B3RMUDA") or the promoter's own list name.
      list: o.artist_invite_id && o.comp_list && o.comp_list !== "Artist" ? "Guest of " + o.comp_list : o.comp_list && o.comp_list !== "Artist" ? o.comp_list : "",
      when: o.paid_at || o.created_at };
  }).filter((p) => p.tickets > 0);
  const byName = (a: any, b: any) => a.name.localeCompare(b.name);
  const artistPeople = people.filter((p) => p.kind === "artist").sort(byName);
  const guests = people.filter((p) => p.kind === "guest").sort(byName);
  const buyers = people.filter((p) => p.kind === "sold").sort((a, b) => String(b.when).localeCompare(String(a.when)));
  const checkedIn = real.filter((x) => scanned.has(x.id)).length;
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
    on_sale: !!ev.sales_open, sold, money_cents: money, artist_passes: artistPasses, guest_count: guestCount, checked_in: checkedIn, tests, night_meters: nightMeters, now_prices: nowPrices,
    by_type: byType, prices, last7: days, artists, checks,
    playlist: { mode: pl.mode || "subduction", tracks: (pl.tracks || []).length, artist_tracks: artistTracks ?? 0 },
    can_add_guests: canAdd, lineup,
    door: canAdd ? { link: `${SITE}/door.html?e=${ev.slug}`, has_pin: !!ev.door_pin_hash } : null, artist_people: artistPeople.map(({ kind, order_id, ...p }) => p), guests: guests.map(({ kind, ...g }) => g), buyers: buyers.map(({ kind, list, order_id, ...b }) => b) };
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
        // Second, tighter limit on every call (new email or not), so the answer never depends on who has an account.
        const { data: n2 } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, "account-new") });
        if ((n2 ?? 0) > 3) return no("Too many tries. Wait a minute and try again.", 429);
        const ip = (req.headers.get("cf-connecting-ip") || "").split(",")[0].trim();
        if (!(await botCheck(b.turnstile, ip))) return no("Bot check failed. Refresh and try again.", 403);
        await sendSignin(email);
        return json({ sent: true });   // same answer either way, so this can't be used to find out who's here
      }
      if (b.a === "code") {
        const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, "account-code") });
        if ((n ?? 0) > 10) return no("Too many tries. Wait a minute.", 429);
        const email = String(b.email || "").trim().toLowerCase().slice(0, 254), code = String(b.code || "").replace(/\D/g, "");
        const bad = () => no("That code didn't work. Check it, or send a new one.");
        if (!EMAIL_RE.test(email) || code.length !== 6) return bad();
        const { data: m } = await db.from("subscribers").select("id,email,status,access_token").eq("email", email).maybeSingle();
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
        return json({ token, email: m.email, member: m.access_token });
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
        const { data: m } = await db.from("subscribers").select("id,email,status,access_token").eq("id", c.subscriber_id).maybeSingle();
        if (!m || m.status === "deleted") return bad();
        const token = hex(32);
        await db.from("admin_sessions").insert({ subscriber_id: m.id, token_hash: await sha256(token), expires_at: new Date(Date.now() + 30 * 86400000).toISOString() });
        return json({ token, email: m.email, member: m.access_token });
      }
      if (b.a === "member") {
        const refuse = () => no("Sign in with your email.", 401);
        const { data: n, error: re } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, "account-member") });
        if (re || n == null) return refuse();   // the counter failed: refuse rather than allow
        if (n > 10) return no("Too many tries. Wait a minute.", 429);
        const key = String(b.key || "").trim().toLowerCase();
        if (!UUID_RE.test(key)) return refuse();
        // Member key only (access_token). The weaker light_token QR key is never accepted.
        const { data: m } = await db.from("subscribers").select("id,email,status").eq("access_token", key).maybeSingle();
        if (!m || m.status === "deleted") return refuse();
        // Read the admin list directly so a failed read refuses (setting() swallows errors).
        const { data: adm, error: ae } = await db.from("settings").select("value").eq("key", "admin_emails").maybeSingle();
        if (ae) return refuse();
        const list = Array.isArray(adm?.value) ? (adm!.value as unknown[]).map((e) => String(e).toLowerCase()) : [];
        if (list.includes(String(m.email).toLowerCase())) return refuse();
        const { data: staff, error: se } = await db.from("company_staff").select("company_id").eq("subscriber_id", m.id).limit(1);
        if (se || !staff || staff.length) return refuse();   // crew and staff carry promoter powers, so they use the email sign-in
        const { data: inv, error: ie } = await db.from("artist_invites").select("id").ilike("email", String(m.email).toLowerCase()).limit(1);
        if (ie || !inv || inv.length) return refuse();   // anyone with an artist invite signs in with their email
        const token = hex(32);
        // Lower trust than an email sign-in: 24 hours, and home() hides tickets and passes for it.
        await db.from("admin_sessions").insert({ subscriber_id: m.id, token_hash: await sha256(token), expires_at: new Date(Date.now() + 86400000).toISOString() });
        return json({ token, email: m.email, limited: true });
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
      if (b.a === "door_pin" || b.a === "door_open") {
        // Door app access for the show's crew owner. door_open signs this phone into the door app the same
        // way a PIN does (scan + find, this show only); door_pin sets the show's door PIN for their door people.
        // Same session table and the same PIN fingerprint the door function checks; the door's own code is unchanged.
        const me = await who(req);
        if (!me) return no("Sign in again.", 401);
        const slug = String(b.e || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
        const { data: ev } = await db.from("events").select("id,slug,company_id").eq("slug", slug).maybeSingle();
        if (!ev) return no("Not found", 404);
        let allowed = (await admins()).includes(String(me.email).toLowerCase());
        if (!allowed) {
          const { data: row } = await db.from("company_staff").select("role").eq("subscriber_id", me.id).eq("company_id", ev.company_id).maybeSingle();
          allowed = row?.role === "owner";
        }
        if (!allowed) return no("Only the show's crew owner can do that.", 403);
        if (b.a === "door_open") {
          const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((x) => x.toString(16).padStart(2, "0")).join("");
          await db.from("door_sessions").insert({ event_id: ev.id, token_hash: await sha256(token), expires_at: new Date(Date.now() + 36 * 3600_000).toISOString() });
          await db.from("engagement_events").insert({ subscriber_id: me.id, type: "crew:door_open", meta: { event: slug } });
          return json({ token });
        }
        const pin = String(b.pin ?? "").replace(/\D/g, "");
        if (pin.length < 4 || pin.length > 8) return no("Use 4 to 8 numbers for the door PIN.");
        if (/^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) return no("Pick a PIN that's harder to guess than " + pin + ".");
        const salt = await setting<string>("ip_salt", "unset");
        await db.from("events").update({ door_pin_hash: await sha256(`door|${ev.id}|${pin}|${salt}`) }).eq("id", ev.id);
        await db.from("engagement_events").insert({ subscriber_id: me.id, type: "crew:door_pin", meta: { event: slug } });
        return json({ saved: true });
      }
      if (b.a === "lineup") {
        // The crew owner edits the DRAFT lineup and set times only (lineup_full / blurb_full). Nothing here
        // ever writes the public lineup or the public blurbs: going live stays a staff "publish" in /admin.
        const me = await who(req);
        if (!me) return no("Sign in again.", 401);
        const slug = String(b.e || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
        const { data: ev } = await db.from("events").select("id,slug,company_id").eq("slug", slug).maybeSingle();
        if (!ev) return no("Not found", 404);
        let allowed = (await admins()).includes(String(me.email).toLowerCase());
        if (!allowed) {
          const { data: row } = await db.from("company_staff").select("role").eq("subscriber_id", me.id).eq("company_id", ev.company_id).maybeSingle();
          allowed = row?.role === "owner";
        }
        if (!allowed) return no("Only the show's crew owner can edit the lineup.", 403);
        const [{ data: ns }, { data: ts }] = await Promise.all([
          db.from("ticket_nights").select("id").eq("event_id", ev.id),
          db.from("ticket_types").select("id,slug,night_ids").eq("event_id", ev.id),
        ]);
        const list = Array.isArray(b.nights) ? b.nights as Record<string, unknown>[] : [];
        let saved = 0;
        for (const item of list) {
          const n = (ns || []).find((x) => x.id === item.id); if (!n) continue;
          const acts = (Array.isArray(item.acts) ? item.acts as Record<string, unknown>[] : []).slice(0, 30)
            .map((x) => ({ name: (clean(x.name, 80) || "").trim(), note: (clean(x.note, 40) || "").trim(), secret: x.secret === true })).filter((x) => x.name)
            .map((x) => ({ name: x.name, ...(x.note ? { note: x.note } : {}), ...(x.secret ? { secret: true } : {}) }));
          await db.from("ticket_nights").update({ lineup_full: acts }).eq("id", n.id);
          // Same draft blurb the staff editor writes ("Treegaud b2b Waylo, Badguy Moolah + more"); public blurb untouched.
          const named = acts.filter((x) => !/special guest/i.test(x.name)), top = named.slice(0, 2).map((x) => x.name);
          const blurb = top.length ? top.join(", ") + (acts.length > top.length ? " + more" : "") : null;
          for (const t of (ts || []).filter((t) => t.slug !== "test" && (t.night_ids || []).length === 1 && t.night_ids[0] === n.id)) {
            await db.from("ticket_types").update({ blurb_full: blurb }).eq("id", t.id);
          }
          saved++;
        }
        await db.from("engagement_events").insert({ subscriber_id: me.id, type: "crew:lineup_draft", meta: { event: slug, nights: saved } });
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
