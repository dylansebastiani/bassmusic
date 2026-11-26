// Event JSON-LD for an approved promoter show.
// The all-in price is checkout's totals() for one paid ticket:
// ceil((price + fee + 30) / (1 - 0.029)). A $25 ticket with a $1.50 fee is $27.61.
// T.O.F.T.U. (slug underground, event 63b511f3-d838-404f-9c2e-5d4b98fbf013) is left out
// through the end of Jan 9, 2027 Chicago time. Its /underground/ page is not edited here.

export const TOFTU_ID = "63b511f3-d838-404f-9c2e-5d4b98fbf013";
export const TOFTU_SLUG = "underground";
export const TOFTU_SCHEMA_AFTER = Date.parse("2027-01-10T00:00:00-06:00");
export const CARD_PCT = 0.029;
export const CARD_FIXED = 30;

export function schemaHeld(id, slug, now = Date.now()) {
  if (id !== TOFTU_ID && slug !== TOFTU_SLUG) return false;
  return now < TOFTU_SCHEMA_AFTER;
}

export function allInCents(priceCents, feePerTicket) {
  const price = Number(priceCents) || 0;
  if (price <= 0) return 0;
  const platform = Number(feePerTicket) > 0 ? Number(feePerTicket) : 0;
  return Math.ceil((price + platform + CARD_FIXED) / (1 - CARD_PCT));
}

export function currentTier(tiers, taken) {
  const list = Array.isArray(tiers) ? tiers : [];
  let start = 0;
  const sold = Number(taken) || 0;
  for (const tier of list) {
    const qty = Number(tier && tier.qty) || 0;
    if (sold < start + qty) return { tier, soldOut: false };
    start += qty;
  }
  return { tier: list.length ? list[list.length - 1] : null, soldOut: true };
}

const SKIP = new Set(["test", "artist"]);

export function offerInputs(types, takenById) {
  const out = [];
  for (const t of Array.isArray(types) ? types : []) {
    if (!t || t.on_sale === false || SKIP.has(t.slug)) continue;
    const { tier, soldOut } = currentTier(t.tiers, takenById && takenById[t.id]);
    const price = tier ? Number(tier.price_cents) : NaN;
    if (!Number.isFinite(price) || price < 0) continue;
    out.push({ name: String(t.name || "Ticket"), priceCents: price, soldOut });
  }
  return out;
}

function plain(s, max) {
  const t = String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : "";
}
function httpsUrl(v) {
  return typeof v === "string" && /^https:\/\//.test(v) ? v : null;
}
function iso(v) {
  if (!v || typeof v !== "string" || !Number.isFinite(Date.parse(v))) return null;
  return v;
}

export function eventJsonLd(input, now = Date.now()) {
  if (!input || input.reviewStatus !== "approved" || input.legacyStripe) return null;
  if (schemaHeld(input.id, input.slug, now)) return null;
  const slug = String(input.slug || "");
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const name = plain(input.name, 200);
  if (!name) return null;
  const nights = Array.isArray(input.nights) ? input.nights : [];
  const starts = nights.map((n) => iso(n && n.starts_at)).filter(Boolean);
  const startDate = starts[0] || iso(input.startsAt);
  if (!startDate) return null;
  const ends = nights.map((n) => iso(n && (n.ends_at || n.starts_at))).filter(Boolean);
  const endDate = ends.length ? ends[ends.length - 1] : null;

  const secret = !!input.locationSecret;
  const location = { "@type": "Place", name: plain(secret ? "Secret location" : (input.venue || input.city || "Venue"), 200) };
  const city = plain(input.city, 120);
  const street = secret ? "" : plain(input.address, 300);
  if (street || city) {
    const address = { "@type": "PostalAddress", addressCountry: "US" };
    if (street) address.streetAddress = street;
    if (city) address.addressLocality = city;
    location.address = address;
  }

  const pageUrl = String(input.pageUrl || "https://subduction.art").replace(/\/$/, "") + "/" + slug;
  const images = [];
  for (const u of [input.shareUrl, input.posterUrl, input.heroUrl]) {
    const h = httpsUrl(u);
    if (h && !images.includes(h)) images.push(h);
  }
  const event = {
    "@context": "https://schema.org",
    "@type": "Event",
    name,
    startDate,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    location,
    url: pageUrl,
  };
  if (endDate && Date.parse(endDate) >= Date.parse(startDate)) event.endDate = endDate;
  const desc = plain(input.description, 500);
  if (desc) event.description = desc;
  if (images.length) event.image = images;
  const org = plain(input.organizerName, 200);
  if (org) event.organizer = { "@type": "Organization", name: org };

  if (typeof input.feePerTicket === "number" && input.feePerTicket >= 0 && Array.isArray(input.offers) && input.offers.length) {
    const offers = input.offers.map((o) => {
      const availability = o.soldOut ? "https://schema.org/SoldOut" : input.salesOpen ? "https://schema.org/InStock" : "https://schema.org/PreOrder";
      return {
        "@type": "Offer",
        name: plain(o.name, 120) || "Ticket",
        price: (allInCents(o.priceCents, input.feePerTicket) / 100).toFixed(2),
        priceCurrency: "USD",
        url: pageUrl,
        availability,
      };
    });
    event.offers = offers.length === 1 ? offers[0] : offers;
  }
  return event;
}
