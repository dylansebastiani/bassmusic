// Public list of approved, published promoter shows, read by the site build to give each one its own page
// at subduction.art/<slug>. A show a promoter has only sent (draft, submitted, rejected) is not in this list
// and has no share image here. Each approved promoter show also gets Event markup (schema) for Google.
// T.O.F.T.U. is left out of that markup through Jan 9, 2027. Self-contained aside from that helper,
// so a deploy of this function cannot pull in ticketing code.
//   GET           the list: slug, name, share image, and Event markup when it applies
//   GET  ?e=slug  one approved show's published page design (or null), plus its Event markup. Nothing private.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { eventJsonLd, offerInputs } from "./schema.mjs";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = (Deno.env.get("SITE_URL") || "https://subduction.art").replace(/\/$/, "");
const COLS = "id,slug,name,venue,city,address,description,location_secret,sales_open,poster_url,share_url,page,starts_at,review_status,page_published_at,company_id";

async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

async function schemasFor(rows: Record<string, any>[]): Promise<Map<string, object>> {
  const out = new Map<string, object>();
  const eligible = rows.filter((r) => r && r.review_status === "approved" && r.page_published_at);
  if (!eligible.length) return out;
  const ids = eligible.map((r) => r.id);
  const companyIds = [...new Set(eligible.map((r) => r.company_id).filter(Boolean))];
  if (!companyIds.length) return out;
  const [{ data: cos }, { data: nights }, { data: types }] = await Promise.all([
    db.from("companies").select("id,name,legacy_stripe,platform_fee_cents").in("id", companyIds),
    db.from("ticket_nights").select("event_id,starts_at,ends_at,sort").in("event_id", ids).order("sort"),
    db.from("ticket_types").select("id,event_id,slug,name,tiers,on_sale,sort").in("event_id", ids).order("sort"),
  ]);
  const companies = new Map((cos || []).map((c) => [c.id, c]));
  const promoters = eligible.filter((r) => {
    const c = companies.get(r.company_id);
    return c && !c.legacy_stripe;
  });
  if (!promoters.length) return out;
  let defaultFee: number | null | undefined;
  async function feeFor(c: { platform_fee_cents: number | null }) {
    if (typeof c.platform_fee_cents === "number") return c.platform_fee_cents;
    if (defaultFee === undefined) {
      const v = await setting<number | null>("platform_fee_cents", null);
      defaultFee = typeof v === "number" && v >= 0 ? v : null;
    }
    return defaultFee;
  }
  const mine = (types || []).filter((t) => promoters.some((p) => p.id === t.event_id) && t.on_sale && t.slug !== "test" && t.slug !== "artist");
  const taken: Record<string, number> = {};
  await Promise.all(mine.map(async (t) => {
    const { data: n } = await db.rpc("ticket_type_taken", { p_type: t.id });
    taken[t.id] = (n as number) || 0;
  }));
  for (const ev of promoters) {
    const co = companies.get(ev.company_id);
    const hero = ev.page && ev.page.art && typeof ev.page.art.hero === "string" ? ev.page.art.hero : null;
    const schema = eventJsonLd({
      id: ev.id, slug: ev.slug, name: ev.name, reviewStatus: ev.review_status, legacyStripe: false,
      venue: ev.venue, city: ev.city, address: ev.address, locationSecret: !!ev.location_secret,
      description: ev.description, salesOpen: !!ev.sales_open, startsAt: ev.starts_at,
      shareUrl: ev.share_url, posterUrl: ev.poster_url, heroUrl: hero,
      nights: (nights || []).filter((n) => n.event_id === ev.id),
      offers: offerInputs((types || []).filter((t) => t.event_id === ev.id), taken),
      feePerTicket: await feeFor(co), pageUrl: SITE, organizerName: co.name,
    });
    if (schema) out.set(ev.id, schema);
  }
  return out;
}

const TOFTU_ID = "63b511f3-d838-404f-9c2e-5d4b98fbf013";
function publicShow(row: Record<string, any>, schema: object | null) {
  const description = typeof row.description === "string" ? row.description.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const image = (typeof row.share_url === "string" && /^https:\/\//.test(row.share_url) && row.share_url)
    || (typeof row.poster_url === "string" && /^https:\/\//.test(row.poster_url) && row.poster_url)
    || null;
  return { id: row.id, slug: row.slug, name: row.name, share_url: row.share_url, poster_url: row.poster_url || null, image, description, review_status: row.review_status, location_secret: !!row.location_secret, schema };
}

Deno.serve(async (req) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const one = new URL(req.url).searchParams.get("e");
  if (one !== null) {
    if (!/^[a-z0-9-]{1,80}$/.test(one)) return new Response(JSON.stringify({ page: null, schema: null }), { status: 404, headers });
    const { data: ev } = await db.from("events").select(COLS).eq("slug", one).maybeSingle();
    // Not approved: say so with an empty page, and don't cache it, so the moment it is approved the design can show.
    if (ev && ev.review_status !== "approved") return new Response(JSON.stringify({ page: null, schema: null }), { status: 404, headers: { ...headers, "Cache-Control": "no-store" } });
    let schema = null;
    if (ev && ev.page_published_at) {
      try { schema = (await schemasFor([ev])).get(ev.id) ?? null; }
      catch (e) { console.error("shows schema", (e as Error).message); }
    }
    return new Response(JSON.stringify({ page: ev && ev.page_published_at ? ev.page ?? null : null, schema }), { headers: { ...headers, "Cache-Control": "public, max-age=60" } });
  }
  // Approved promoter shows, including ones whose page design is not published yet, so the site build
  // can give each a real address and a preview image. T.O.F.T.U. stays off this list.
  const { data, error } = await db.from("events").select(COLS).eq("review_status", "approved").eq("is_public", true).eq("is_active", true).not("company_id", "is", null).neq("slug", "underground").neq("id", TOFTU_ID).order("created_at", { ascending: false }).limit(500);
  if (error) { console.error("shows", error.message); return new Response(JSON.stringify({ shows: [] }), { status: 500, headers }); }
  let map = new Map<string, object>();
  try { map = await schemasFor(data || []); }
  catch (e) { console.error("shows schema", (e as Error).message); }
  return new Response(JSON.stringify({ shows: (data || []).map((r) => publicShow(r, map.get(r.id) ?? null)) }), { headers });
});
