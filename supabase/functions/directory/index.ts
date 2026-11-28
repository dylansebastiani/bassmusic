// Public Midwest show directory (subduction.art/shows).
// Reads no ticketing code. Its only shared imports are the client-IP helper and the bot check. It is on the safe deploy list.
//   GET                         upcoming approved listings plus approved Subduction shows that are on sale
//   POST form/json a=submit     a promoter files an external show (Turnstile). It stays pending. They get a one-time edit link.
//   POST a=parse                reads a Posh, Eventbrite, DICE or RA page for prefill. Fails quietly.
//   POST a=link                 asks for a new edit link. Same answer whether or not the email is known.
//   POST a=open {k}             trades a one-time link (7 days) for a 2 hour edit session
//   POST a=mine|edit {s}        the owner's own view and edits. Edits to a live show go back to the queue.
//   GET  ?a=review&k=token      the one listing in Dylan's email link
//   POST {a:approve|reject, k}  the buttons on that page. A GET never approves anything.
//   GET  ?a=pending             the waiting list, staff session only (the same token /admin already stores)
//   POST {a:approve|reject, id} staff session
// The existing `shows` function is the build list of published pages. This function does not replace it.
import { ipFromHeaders } from "../_shared/client_ip.mjs";
import { clientIp, verifyTurnstile } from "../_shared/util.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  MIDWEST, alertRecipients, canReplyTo, chicagoYmd, cleanText, dateOk, externalCard, formatDay,
  cityPath, honeypotFilled, leadMail, listingPlace, normTicketUrl, publicCard, subductionCard,
} from "./listing.mjs";
import {
  UNSUB_HEADER, NEUTRAL_SUBMIT, canonicalEmail, emailPattern, expiry, hashToken, linkCapReached, linkMail, mayMailLink, newLinkMail, newToken, ownerView, parseEvent,
  publicFlyerPath, readShow, redeemLink, reviewExtras, sessionFor, ticketSite,
} from "./submit.mjs";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = (Deno.env.get("SITE_URL") || "https://subduction.art").replace(/\/$/, "");
const CONTACT = "hello@subduction.art";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache, ...CORS } });
const no = (m: string, s = 400) => json({ error: m }, s);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hex(n: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
async function ipHash(req: Request) {
  const ip = ipFromHeaders((h: string) => req.headers.get(h));
  return sha256(ip + "|" + String(await setting("ip_salt", "unset")) + "|directory");
}
function sniff(bytes: Uint8Array): string {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return "";
}
function flyerUrl(path: string | null) {
  if (!path) return "";
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  return base ? `${base}/storage/v1/object/public/directory/${path}` : "";
}

// true = this address is on an artist pass. null = the lookup failed, so send nothing to it.
// Dots and plus tags on either side count as the same address (see canonicalEmail).
async function artistContact(raw: string): Promise<boolean | null> {
  const want = canonicalEmail(raw), pat = emailPattern(raw);
  const same = (e: string | null) => canonicalEmail(e) === want;
  const [a, m] = await Promise.all([
    db.from("artist_invites").select("email").ilike("email", pat).limit(50),
    db.from("artist_members").select("email").ilike("email", pat).limit(50),
  ]);
  if (a.error || m.error) return null;
  return (a.data || []).some((r) => same(r.email)) || (m.data || []).some((r) => same(r.email));
}

// At most 6 link emails an hour per person (any dotted or plus spelling), across all their shows. A failed lookup counts as capped.
async function linkCapHit(email: string): Promise<boolean> {
  const { data: rows, error: e1 } = await db.from("directory_listings").select("id,submitter_email").ilike("submitter_email", emailPattern(email)).limit(200);
  if (e1) return true;
  const want = canonicalEmail(email);
  const ids = (rows || []).filter((r) => canonicalEmail(r.submitter_email) === want);
  if (!ids.length) return false;
  const since = new Date(Date.now() - 3600000).toISOString();
  const { count, error } = await db.from("directory_links").select("id", { count: "exact", head: true }).eq("kind", "link").in("listing_id", ids.map((r) => r.id)).gte("created_at", since);
  return error ? true : linkCapReached(count);
}

async function admins(): Promise<string[]> {
  const raw = await setting<unknown>("admin_emails", []);
  return (Array.isArray(raw) ? raw : []).map((e) => String(e).toLowerCase().trim()).filter((e) => EMAIL_RE.test(e));
}

// The staff session /admin already issued. Checked here so the admin function stays untouched.
async function staff(req: Request): Promise<{ email: string } | null> {
  const token = (req.headers.get("x-admin-token") || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data: s } = await db.from("admin_sessions").select("subscriber_id,expires_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  const { data: m } = await db.from("subscribers").select("email,status").eq("id", s.subscriber_id).maybeSingle();
  if (!m || m.status === "deleted") return null;
  const email = String(m.email || "").toLowerCase();
  if (!(await admins()).includes(email)) return null;
  return { email };
}

async function subductionShows(today: string) {
  const { data, error } = await db.from("events")
    .select("id,slug,name,city,location_secret,review_status,sales_open,page_published_at,starts_at,is_active,is_public,share_url,poster_url")
    .eq("review_status", "approved").eq("is_active", true).eq("is_public", true).limit(200);
  if (error) { console.error("directory: events", error.message); return []; }
  const rows = (data || []).filter((e) => e.sales_open || e.page_published_at);
  if (!rows.length) return [];
  const slugById: Record<string, string> = {};
  for (const e of rows) slugById[e.id] = e.slug;
  const bySlug: Record<string, { starts_at: string; flyer_url: unknown }[]> = {};
  const { data: ns, error: nErr } = await db.from("ticket_nights").select("event_id,starts_at,flyer_url").in("event_id", rows.map((e) => e.id)).order("starts_at");
  if (nErr) console.error("directory: nights", nErr.message);
  for (const n of ns || []) {
    const slug = slugById[n.event_id];
    if (slug && n.starts_at) (bySlug[slug] ||= []).push({ starts_at: n.starts_at, flyer_url: n.flyer_url });
  }
  const cards = [];
  for (const ev of rows) {
    const card = subductionCard(ev, bySlug[ev.slug] || [], today);
    if (card) cards.push(publicCard(card));
  }
  return cards;
}

async function listingShows(today: string) {
  const { data, error } = await db.from("directory_listings")
    .select("name,show_date,venue_secret,secret_reveal_at,city,state,ticket_url,flyer_path,public_flyer_path,status,reviewed_at")
    .eq("status", "approved").gte("show_date", today).order("show_date").limit(200);
  if (error) { console.error("directory: listings", error.message); return []; }
  const cards = [];
  for (const row of data || []) {
    const card = externalCard({ ...row, flyer_url: flyerUrl(publicFlyerPath(row)) }, today, new Date());
    if (card) cards.push(publicCard(card));
  }
  return cards;
}

function reviewView(row: Record<string, unknown>) {
  const place = listingPlace(String(row.city || ""), String(row.state || ""));
  return {
    id: row.id,
    name: row.name,
    when: formatDay(String(row.show_date || "").slice(0, 10)) || String(row.show_date || ""),
    venue: row.venue,
    venue_secret: !!row.venue_secret,
    city: place.city,
    state: place.state,
    ticket_url: row.ticket_url,
    flyer: flyerUrl(row.flyer_path as string | null),
    email: row.submitter_email,
    updated_at: row.updated_at,
    ...reviewExtras(row as never),
  };
}
const REVIEW_COLS = "id,name,show_date,venue,venue_secret,secret_reveal_at,city,state,ticket_url,flyer_path,public_flyer_path,submitter_email,status,was_live,lineup,price,sounds,artist_socials,promoter_ig,age,source,updated_at";

// Brevo send (the same one the promoter lead uses). The daily mail runner never sees it.
type Mail = { subject: string; text: string; fromName: string; tag: string };
async function sendMail(mail: Mail, to: string[], replyTo: string, unsub = false) {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key || !to.length) { console.error("directory: mail skipped", !key ? "BREVO_API_KEY not set" : "no recipient"); return; }
  const addr = String(await setting("mailing_address", ""));
  const text = mail.text + (addr && !/TBD/i.test(addr) && !mail.text.includes(addr) ? "\n\nSubduction\n" + addr : "");
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: mail.fromName, email: Deno.env.get("FROM_EMAIL") || CONTACT },
        replyTo: replyTo ? { email: replyTo } : undefined,
        to: to.map((email) => ({ email })),
        subject: mail.subject,
        textContent: text,
        htmlContent: "<pre style=\"font:15px/1.6 Arial,sans-serif\">" + esc(text) + "</pre>",
        headers: unsub ? { "List-Unsubscribe": UNSUB_HEADER } : undefined,
        tags: [mail.tag],
      }),
    });
    if (!r.ok) console.error("directory: mail failed", r.status, (await r.text().catch(() => "")).slice(0, 200));
  } catch (e) { console.error("directory: mail failed", (e as Error).message); }
}
const tellDylan = (mail: Mail, to: string[], replyTo: string) => sendMail(mail, to, replyTo);

// Links and sessions live in directory_links, found only by the hash of the token.
const linkStore = {
  async find(hash: string) {
    const { data } = await db.from("directory_links").select("id,listing_id,kind,expires_at,used_at").eq("token_hash", hash).maybeSingle();
    return data;
  },
  async markUsed(id: string, iso: string) {
    const { data } = await db.from("directory_links").update({ used_at: iso }).eq("id", id).is("used_at", null).select("id");
    return !!(data && data.length);
  },
};
async function issue(listingId: string, kind: "link" | "session") {
  const token = newToken();
  const { error } = await db.from("directory_links").insert({ listing_id: listingId, kind, token_hash: await hashToken(token), expires_at: expiry(kind, new Date()).toISOString() });
  if (error) { console.error("directory: link", error.message); return ""; }
  return token;
}

// Reads a public ticket page for prefill. Only the four known sites, https only, redirects re-checked, 6s and 600KB caps.
async function fetchPage(start: string): Promise<string> {
  let u = start;
  for (let hop = 0; hop < 4; hop++) {
    if (!ticketSite(u)) return "";
    const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(6000), headers: { Accept: "text/html", "User-Agent": "SubductionShowCheck/1.0 (+https://subduction.art)" } });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return "";
      try { u = new URL(loc, u).toString(); } catch { return ""; }
      continue;
    }
    if (!r.ok || !/text\/html/i.test(r.headers.get("content-type") || "") || !r.body) return "";
    const reader = r.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    while (total < 600000) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      parts.push(value); total += value.length;
    }
    await reader.cancel().catch(() => {});
    const all = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    return new TextDecoder().decode(all);
  }
  return "";
}

type Img = { bytes: Uint8Array; mime: string };
const IMG_ERR = "Add a flyer. JPEG, PNG or WebP, under 1.5 MB.";
function checkImage(bytes: Uint8Array | null): { img?: Img; error?: string } | null {
  if (!bytes || !bytes.length) return null;
  if (bytes.length > 1572864) return { error: "That flyer is too big. Keep it under 1.5 MB." };
  const mime = sniff(bytes);
  return mime ? { img: { bytes, mime } } : { error: IMG_ERR };
}
async function saveImage(id: string, img: Img) {
  const ext = img.mime === "image/png" ? "png" : img.mime === "image/webp" ? "webp" : "jpg";
  const path = `${id}-${hex(4)}.${ext}`;
  const { error } = await db.storage.from("directory").upload(path, new Blob([img.bytes], { type: img.mime }), { contentType: img.mime, upsert: false });
  if (error) { console.error("directory: upload", error.message); return ""; }
  return path;
}
async function limited(req: Request, bucket: string, max: number) {
  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await sha256((await ipHash(req)) + "|" + bucket) });
  return (n ?? 0) > max;
}
async function botCheck(req: Request, f: Record<string, string>) {
  return verifyTurnstile(cleanText(f.turnstile, 4000) || null, clientIp(req), cleanText(f.ts_err, 20) || null);
}
const OWNER_COLS = "id,name,show_date,venue,venue_secret,secret_reveal_at,city,state,ticket_url,flyer_path,public_flyer_path,submitter_email,status,was_live,lineup,price,sounds,artist_socials,promoter_ig,age,source";
const mine = (row: Record<string, unknown>) => ownerView(row as never, flyerUrl, SITE, cityPath);

// Approving needs the updated_at the reviewer saw. A show edited after the page opened is refused, not approved blind.
async function decide(row: { id: string; status: string }, status: "approved" | "rejected", seen: string) {
  if (row.status !== "pending") return json({ ok: true, status: row.status });
  if (status === "approved" && !seen) return no("Reload the page and look again.", 409);
  let q = db.from("directory_listings").update({ status, reviewed_at: new Date().toISOString() }).eq("id", row.id).eq("status", "pending");
  if (status === "approved") q = q.eq("updated_at", seen);
  const { data, error } = await q.select("id");
  if (error) { console.error("directory: review", error.message); return no("Couldn't save that. Try again.", 500); }
  if (!data || !data.length) return no("This show changed. Reload the page and look again.", 409);
  return json({ ok: true, status });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const today = chicagoYmd(new Date());

  if (req.method === "GET") {
    const a = url.searchParams.get("a") || "";
    if (a === "review") {
      const k = url.searchParams.get("k") || "";
      if (!TOKEN_RE.test(k)) return no("Not found", 404);
      const { data: row } = await db.from("directory_listings").select(REVIEW_COLS).eq("review_token_hash", await sha256(k)).maybeSingle();
      if (!row) return no("Not found", 404);
      return json({ show: reviewView(row) });
    }
    if (a === "pending") {
      if (!await staff(req)) return no("Sign in again.", 401);
      const { data, error } = await db.from("directory_listings").select(REVIEW_COLS + ",created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(50);
      if (error) return no("Couldn't load that. Try again.", 500);
      return json({ pending: ((data || []) as unknown as Record<string, unknown>[]).map(reviewView) });
    }
    const [own, listed] = await Promise.all([subductionShows(today), listingShows(today)]);
    const shows = [...own, ...listed].sort((x, y) => (x.dates[0] || "").localeCompare(y.dates[0] || "") || x.name.localeCompare(y.name));
    return json({ shows }, 200, "public, max-age=60, stale-while-revalidate=300");
  }

  if (req.method !== "POST") return no("Not allowed", 405);
  const ctype = req.headers.get("content-type") || "";
  let fields: Record<string, string> = {};
  let flyer: Uint8Array | null = null;
  let pub: Uint8Array | null = null;
  if (ctype.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); } catch { return no("Bad request"); }
    form.forEach((v, k) => { if (typeof v === "string") fields[k] = v; });
    for (const [key, slot] of [["flyer", "flyer"], ["public_flyer", "pub"]] as const) {
      const file = form.get(key);
      if (file && typeof file !== "string") { const b = new Uint8Array(await file.arrayBuffer()); if (slot === "flyer") flyer = b; else pub = b; }
    }
  } else {
    try { fields = await req.json(); } catch { return no("Bad request"); }
    if (!fields || typeof fields !== "object") return no("Bad request");
  }
  const a = fields.a || "";

  if (a === "approve" || a === "reject") {
    const status = a === "approve" ? "approved" : "rejected";
    const k = cleanText(fields.k, 80);
    if (TOKEN_RE.test(k)) {
      const { data: row } = await db.from("directory_listings").select("id,status").eq("review_token_hash", await sha256(k)).maybeSingle();
      if (!row) return no("Not found", 404);
      return decide(row, status, cleanText(fields.updated_at, 64));
    }
    const id = cleanText(fields.id, 40);
    if (!UUID_RE.test(id) || !await staff(req)) return no("Sign in again.", 401);
    const { data: row } = await db.from("directory_listings").select("id,status").eq("id", id).maybeSingle();
    if (!row) return no("Not found", 404);
    return decide(row, status, cleanText(fields.updated_at, 64));
  }

  if (a === "parse") {
    if (await limited(req, "parse", 12)) return no("Too many tries. Wait a minute.", 429);
    const link = normTicketUrl(fields.url);
    if (!link || !ticketSite(link)) return json({ ok: true, fields: {}, from: {}, site: "" });
    try { return json({ ok: true, ...parseEvent(await fetchPage(link), link) }); }
    catch (e) { console.error("directory: parse", (e as Error).message); return json({ ok: true, fields: {}, from: {}, site: "" }); }
  }

  if (a === "open") {
    if (await limited(req, "open", 20)) return no("Too many tries. Wait a minute.", 429);
    const res = await redeemLink(linkStore, cleanText(fields.k, 80), new Date());
    if (!res.ok) return json({ ok: false, reason: res.reason }, 410);
    const { data: row } = await db.from("directory_listings").select(OWNER_COLS).eq("id", res.listing_id).maybeSingle();
    const session = row ? await issue(res.listing_id, "session") : "";
    if (!row || !session) return json({ ok: false, reason: "missing" }, 410);
    return json({ ok: true, session, show: mine(row) });
  }

  if (a === "mine" || a === "edit") {
    if (await limited(req, "mine", 60)) return no("Too many tries. Wait a minute.", 429);
    const listingId = await sessionFor(linkStore, cleanText(fields.s, 80), new Date());
    if (!listingId) return no("That link has run out. Ask for a new one.", 401);
    const { data: row } = await db.from("directory_listings").select(OWNER_COLS).eq("id", listingId).maybeSingle();
    if (!row) return no("Not found", 404);
    if (a === "mine") return json({ ok: true, show: mine(row) });
    if (!(await botCheck(req, fields))) return no("Bot check failed. Refresh and try again.", 403);

    const parsed = readShow(fields, today);
    if (!parsed.data) return no(parsed.error || "Check the form.");
    const f1 = checkImage(flyer), f2 = checkImage(pub);
    if (f1?.error || f2?.error) return no(f1?.error || f2?.error || IMG_ERR);
    const { data: dup } = await db.from("directory_listings").select("id").eq("ticket_url", parsed.data.ticket_url).neq("id", row.id).in("status", ["pending", "approved"]).maybeSingle();
    if (dup) return no("Couldn't save that. Check the ticket link and try again.");
    const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
    const old: string[] = [];
    if (f1?.img) { const p = await saveImage(row.id, f1.img); if (!p) return no("Couldn't save that flyer. Try again.", 500); if (row.flyer_path) old.push(row.flyer_path); patch.flyer_path = p; }
    if (f2?.img) { const p = await saveImage(row.id, f2.img); if (!p) return no("Couldn't save that flyer. Try again.", 500); if (row.public_flyer_path) old.push(row.public_flyer_path); patch.public_flyer_path = p; }
    // Free while it waits. A live (or turned-down) show goes back to the queue and Dylan gets a fresh link.
    const requeue = row.status !== "pending";
    let reviewToken = "";
    if (requeue) {
      reviewToken = hex(32);
      Object.assign(patch, { status: "pending", reviewed_at: null, review_token_hash: await sha256(reviewToken), was_live: row.status === "approved" || row.was_live });
    }
    const { data: saved, error } = await db.from("directory_listings").update(patch).eq("id", row.id).select(OWNER_COLS).maybeSingle();
    if (error || !saved) {
      if (error && (error.code === "23505" || /duplicate key/i.test(error.message || ""))) return no("Couldn't save that. Check the ticket link and try again.");
      console.error("directory: edit", error?.message);
      return no("Couldn't save that. Try again.", 500);
    }
    if (old.length) await db.storage.from("directory").remove(old);
    if (requeue) {
      const list = await admins();
      const email = String(row.submitter_email || "");
      const flags = new Map<string, boolean | null>();
      for (const addr of [...list, email]) if (!flags.has(addr)) flags.set(addr, await artistContact(addr));
      const artistOf = (addr: string) => flags.get(addr) ?? null;
      const p = parsed.data;
      const mail = leadMail({
        name: p.name, when: formatDay(p.show_date), venue: p.venue, venue_secret: p.venue_secret, city: p.city, state: p.state,
        ticket_url: p.ticket_url, from: email, subjectTag: row.status === "approved" ? "Live show edited" : "Show edited",
        extra: ["Edited after review. It is back in the waiting list."],
        review_url: `${SITE}/shows-review.html?k=${reviewToken}`,
      });
      await tellDylan(mail, alertRecipients(list, email, artistOf), canReplyTo(email, artistOf) ? email : "");
    }
    return json({ ok: true, requeued: requeue, show: mine(saved) });
  }

  if (a === "link") {
    if (honeypotFilled(fields)) return json({ ok: true });
    if (await limited(req, "link", 5)) return no("Too many tries. Wait a minute.", 429);
    if (!(await botCheck(req, fields))) return no("Bot check failed. Refresh and try again.", 403);
    const email = cleanText(fields.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) return no("That email doesn't look right.");
    // The answer is the same whether or not this address has a show. The work runs after the reply.
    const work = (async () => {
      const { data: rows } = await db.from("directory_listings").select("id,name").eq("submitter_email", email).order("created_at", { ascending: false }).limit(3);
      if (!rows || !rows.length) return;
      if (!mayMailLink(await artistContact(email))) return;
      if (await linkCapHit(email)) return;
      const shows = [];
      for (const r of rows) { const token = await issue(r.id, "link"); if (token) shows.push({ name: r.name, token }); }
      if (shows.length) await sendMail(newLinkMail({ shows, base: `${SITE}/shows-send` }), [email], "", true);
    })().catch((e) => console.error("directory: link", (e as Error).message));
    const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(work); else await work;
    return json({ ok: true });
  }

  if (a !== "submit") return no("Bad request");
  if (honeypotFilled(fields)) return json({ ok: true });

  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req) });
  if ((n ?? 0) > 8) return no("Too many tries. Wait a minute.", 429);
  if (!(await botCheck(req, fields))) return no("Bot check failed. Refresh and try again.", 403);

  const email = cleanText(fields.email, 254).toLowerCase();
  const parsed = readShow(fields, today);
  if (!parsed.data) return no(parsed.error || "Check the form.");
  if (!EMAIL_RE.test(email)) return no("That email doesn't look right.");
  const f1 = checkImage(flyer), f2 = checkImage(pub);
  if (f1?.error || f2?.error) return no(f1?.error || f2?.error || IMG_ERR);
  const d = parsed.data;

  const { data: dup } = await db.from("directory_listings").select("id").eq("ticket_url", d.ticket_url).in("status", ["pending", "approved"]).maybeSingle();
  if (dup) return json(NEUTRAL_SUBMIT);

  const id = crypto.randomUUID();
  const token = hex(32);
  const paths: string[] = [];
  let flyerPath = "", pubPath = "";
  if (f1?.img) { flyerPath = await saveImage(id, f1.img); if (!flyerPath) return no("Couldn't save that flyer. Try again.", 500); paths.push(flyerPath); }
  if (f2?.img) { pubPath = await saveImage(id, f2.img); if (!pubPath) { if (paths.length) await db.storage.from("directory").remove(paths); return no("Couldn't save that flyer. Try again.", 500); } paths.push(pubPath); }

  const { error } = await db.from("directory_listings").insert({
    id, ...d, flyer_path: flyerPath || null, public_flyer_path: pubPath || null,
    submitter_email: email, status: "pending", review_token_hash: await sha256(token), ip_hash: await ipHash(req),
  });
  if (error) {
    if (paths.length) await db.storage.from("directory").remove(paths);
    if (error.code === "23505" || /duplicate key/i.test(error.message || "")) return json(NEUTRAL_SUBMIT);
    console.error("directory: insert", error.message);
    return no("Couldn't save that. Try again.", 500);
  }

  // Artist check first. It guards both Dylan's note and the edit-link mail to the typed address.
  const flags = new Map<string, boolean | null>();
  const list = await admins();
  for (const addr of [...list, email]) {
    if (!flags.has(addr)) flags.set(addr, await artistContact(addr));
  }
  const artistOf = (addr: string) => flags.get(addr) ?? null;

  // The link goes only to a non-artist address and not past the hourly cap. The session is theirs either way.
  const session = await issue(id, "session");
  if (mayMailLink(flags.get(email) ?? null) && !(await linkCapHit(email))) {
    const linkToken = await issue(id, "link");
    if (linkToken) await sendMail(linkMail({ name: d.name, url: `${SITE}/shows-send?k=${linkToken}` }), [email], "", true);
  }
  const mail = leadMail({
    name: d.name, when: formatDay(d.show_date), venue: d.venue, venue_secret: d.venue_secret, city: d.city, state: d.state, ticket_url: d.ticket_url, from: email,
    extra: [
      "Sounds: " + (d.sounds.join(", ") || "-"), "Price: " + (d.price || "-"), "Lineup: " + (d.lineup || "-"),
      "Flyer: " + (flyerPath ? "yes" : "none yet") + "   Source: " + d.source,
    ],
    review_url: `${SITE}/shows-review.html?k=${token}`,
  });
  await tellDylan(mail, alertRecipients(list, email, artistOf), canReplyTo(email, artistOf) ? email : "");
  return json({ ok: true, session });
});
