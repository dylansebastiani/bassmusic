// Public Midwest show directory (subduction.art/shows).
// Self-contained on purpose (no shared imports) so deploying it cannot disturb ticketing.
//   GET                         upcoming approved listings plus approved Subduction shows that are on sale
//   POST form/json a=submit     a visitor files an external show. It stays pending. No mail goes to them.
//   GET  ?a=review&k=token      the one listing in Dylan's email link
//   POST {a:approve|reject, k}  the buttons on that page. A GET never approves anything.
//   GET  ?a=pending             the waiting list, staff session only (the same token /admin already stores)
//   POST {a:approve|reject, id} staff session
// The existing `shows` function is the build list of published pages. This function does not replace it.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  MIDWEST, alertRecipients, canReplyTo, chicagoYmd, cleanText, dateOk, externalCard, formatDay,
  honeypotFilled, leadMail, listingPlace, normTicketUrl, publicCard, subductionCard,
} from "./listing.mjs";

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
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0.0.0.0";
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
async function artistContact(email: string): Promise<boolean | null> {
  const same = (e: string | null) => String(e || "").trim().toLowerCase() === email;
  const [a, m] = await Promise.all([
    db.from("artist_invites").select("email").ilike("email", email).limit(8),
    db.from("artist_members").select("email").ilike("email", email).limit(8),
  ]);
  if (a.error || m.error) return null;
  return (a.data || []).some((r) => same(r.email)) || (m.data || []).some((r) => same(r.email));
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
    .select("id,slug,name,city,venue,location_secret,review_status,sales_open,page_published_at,starts_at,is_active,is_public,share_url,poster_url")
    .eq("review_status", "approved").eq("is_active", true).eq("is_public", true).limit(200);
  if (error) { console.error("directory: events", error.message); return []; }
  const rows = (data || []).filter((e) => e.sales_open || e.page_published_at);
  if (!rows.length) return [];
  const slugById: Record<string, string> = {};
  for (const e of rows) slugById[e.id] = e.slug;
  const bySlug: Record<string, { starts_at: string; lineup: unknown; flyer_url: unknown }[]> = {};
  const { data: ns, error: nErr } = await db.from("ticket_nights").select("event_id,starts_at,lineup,flyer_url").in("event_id", rows.map((e) => e.id)).order("starts_at");
  if (nErr) console.error("directory: nights", nErr.message);
  for (const n of ns || []) {
    const slug = slugById[n.event_id];
    if (slug && n.starts_at) (bySlug[slug] ||= []).push({ starts_at: n.starts_at, lineup: n.lineup, flyer_url: n.flyer_url });
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
    .select("name,show_date,venue,venue_secret,city,state,ticket_url,flyer_path,status,reviewed_at")
    .eq("status", "approved").gte("show_date", today).order("show_date").limit(200);
  if (error) { console.error("directory: listings", error.message); return []; }
  const cards = [];
  for (const row of data || []) {
    const card = externalCard({ ...row, flyer_url: flyerUrl(row.flyer_path) }, today, new Date());
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
    status: row.status,
  };
}

// Same Brevo send the promoter lead uses. Straight to Dylan. The daily mail runner never sees it.
async function tellDylan(mail: ReturnType<typeof leadMail>, to: string[], replyTo: string) {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key || !to.length) { console.error("directory: mail skipped", !key ? "BREVO_API_KEY not set" : "no recipient"); return; }
  const addr = String(await setting("mailing_address", ""));
  const text = mail.text + (addr && !/TBD/i.test(addr) ? "\n\nSubduction\n" + addr : "");
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
        tags: [mail.tag],
      }),
    });
    if (!r.ok) console.error("directory: mail failed", r.status, (await r.text().catch(() => "")).slice(0, 200));
  } catch (e) { console.error("directory: mail failed", (e as Error).message); }
}

async function decide(row: { id: string; status: string }, status: "approved" | "rejected") {
  if (row.status !== "pending") return json({ ok: true, status: row.status });
  const { error } = await db.from("directory_listings").update({ status, reviewed_at: new Date().toISOString() }).eq("id", row.id).eq("status", "pending");
  if (error) { console.error("directory: review", error.message); return no("Couldn't save that. Try again.", 500); }
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
      const { data: row } = await db.from("directory_listings").select("id,name,show_date,venue,venue_secret,city,state,ticket_url,flyer_path,submitter_email,status").eq("review_token_hash", await sha256(k)).maybeSingle();
      if (!row) return no("Not found", 404);
      return json({ show: reviewView(row) });
    }
    if (a === "pending") {
      if (!await staff(req)) return no("Sign in again.", 401);
      const { data, error } = await db.from("directory_listings").select("id,name,show_date,venue,venue_secret,city,state,ticket_url,flyer_path,submitter_email,status,created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(50);
      if (error) return no("Couldn't load that. Try again.", 500);
      return json({ pending: (data || []).map(reviewView) });
    }
    const [own, listed] = await Promise.all([subductionShows(today), listingShows(today)]);
    const shows = [...own, ...listed].sort((x, y) => (x.dates[0] || "").localeCompare(y.dates[0] || "") || x.name.localeCompare(y.name));
    return json({ shows }, 200, "public, max-age=60");
  }

  if (req.method !== "POST") return no("Not allowed", 405);
  const ctype = req.headers.get("content-type") || "";
  let fields: Record<string, string> = {};
  let flyer: Uint8Array | null = null;
  if (ctype.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); } catch { return no("Bad request"); }
    form.forEach((v, k) => { if (typeof v === "string") fields[k] = v; });
    const file = form.get("flyer");
    if (file && typeof file !== "string") flyer = new Uint8Array(await file.arrayBuffer());
  } else {
    try { fields = await req.json(); } catch { return no("Bad request"); }
  }
  const a = fields.a || "";

  if (a === "approve" || a === "reject") {
    const status = a === "approve" ? "approved" : "rejected";
    const k = cleanText(fields.k, 80);
    if (TOKEN_RE.test(k)) {
      const { data: row } = await db.from("directory_listings").select("id,status").eq("review_token_hash", await sha256(k)).maybeSingle();
      if (!row) return no("Not found", 404);
      return decide(row, status);
    }
    const id = cleanText(fields.id, 40);
    if (!UUID_RE.test(id) || !await staff(req)) return no("Sign in again.", 401);
    const { data: row } = await db.from("directory_listings").select("id,status").eq("id", id).maybeSingle();
    if (!row) return no("Not found", 404);
    return decide(row, status);
  }

  if (a !== "submit") return no("Bad request");
  if (honeypotFilled(fields)) return json({ ok: true });

  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req) });
  if ((n ?? 0) > 8) return no("Too many tries. Wait a minute.", 429);

  const name = cleanText(fields.name, 120);
  const when = cleanText(fields.date, 10);
  const venue = cleanText(fields.venue, 120);
  const venueSecret = ["1", "true", "on", "yes"].includes(cleanText(fields.venue_secret, 8).toLowerCase());
  const place = listingPlace(fields.city, fields.state);
  const ticket = normTicketUrl(fields.ticket_url);
  const email = cleanText(fields.email, 254).toLowerCase();
  if (!name) return no("Add the show name.");
  if (!dateOk(when, today)) return no("Add a date that is today or later.");
  if (!venue) return no("Add the venue.");
  if (!place.city) return no("Add the city.");
  if (!MIDWEST.includes(place.state)) return no("Pick a Midwest state.");
  if (!ticket) return no("Add a ticket link that starts with https.");
  if (!EMAIL_RE.test(email)) return no("That email doesn't look right.");
  if (!flyer || !flyer.length) return no("Add a flyer. JPEG, PNG or WebP, under 1.5 MB.");
  if (flyer.length > 1572864) return no("That flyer is too big. Keep it under 1.5 MB.");
  const mime = sniff(flyer);
  if (!mime) return no("Add a flyer. JPEG, PNG or WebP, under 1.5 MB.");

  const { data: dup } = await db.from("directory_listings").select("id").eq("ticket_url", ticket).in("status", ["pending", "approved"]).maybeSingle();
  if (dup) return no("That show is already in.");

  const id = crypto.randomUUID();
  const token = hex(32);
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const path = `${id}.${ext}`;
  const { error: upErr } = await db.storage.from("directory").upload(path, new Blob([flyer], { type: mime }), { contentType: mime, upsert: false });
  if (upErr) { console.error("directory: upload", upErr.message); return no("Couldn't save that flyer. Try again.", 500); }

  const { error } = await db.from("directory_listings").insert({
    id, name, show_date: when, venue, venue_secret: venueSecret, city: place.city, state: place.state, ticket_url: ticket,
    flyer_path: path, submitter_email: email, status: "pending", review_token_hash: await sha256(token),
    ip_hash: await ipHash(req),
  });
  if (error) {
    await db.storage.from("directory").remove([path]);
    if (error.code === "23505" || /duplicate key/i.test(error.message || "")) return no("That show is already in.");
    console.error("directory: insert", error.message);
    return no("Couldn't save that. Try again.", 500);
  }

  const flags = new Map<string, boolean | null>();
  const list = await admins();
  for (const addr of [...list, email]) {
    if (!flags.has(addr)) flags.set(addr, await artistContact(addr));
  }
  const artistOf = (addr: string) => flags.get(addr) ?? null;
  const mail = leadMail({
    name, when: formatDay(when), venue, venue_secret: venueSecret, city: place.city, state: place.state, ticket_url: ticket, from: email,
    review_url: `${SITE}/shows-review.html?k=${token}`,
  });
  await tellDylan(mail, alertRecipients(list, email, artistOf), canReplyTo(email, artistOf) ? email : "");
  return json({ ok: true });
});
