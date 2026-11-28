// Pure rules for the show submit flow (/shows-send). No database, no mail, no Deno APIs.
// The directory function and scripts/submit.test.mjs both import this file.
import { MIDWEST, STATE_NAME, cleanText, dateOk, listingPlace, normTicketUrl } from "./listing.mjs";

export const SOUNDS = ["Dubstep", "Riddim", "DnB", "Bass house", "Warehouse", "Halftime", "Other"];
export const AGES = { all: "All ages", "18": "18+", "21": "21+" };
export const LINK_DAYS = 7;
export const SESSION_HOURS = 2;
export const TOKEN_RE = /^[0-9a-f]{64}$/;

// ---------- tokens ----------
export const isToken = (t) => typeof t === "string" && TOKEN_RE.test(t);

export function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(t) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function expiry(kind, now) {
  const ms = kind === "link" ? LINK_DAYS * 86400000 : SESSION_HOURS * 3600000;
  return new Date(now.getTime() + ms);
}

// "ok", "expired", "used" or "missing". A row is only ever looked up by the hash of the token.
export function linkState(row, now) {
  if (!row) return "missing";
  const exp = new Date(row.expires_at).getTime();
  if (!Number.isFinite(exp) || exp <= now.getTime()) return "expired";
  if (row.kind === "link" && row.used_at) return "used";
  return "ok";
}

// store.find(hash) -> row | null.  store.markUsed(id, iso) -> true only for the one caller that wins.
// A magic link works once. The session it opens is short and lives in the browser tab only.
export async function redeemLink(store, token, now) {
  if (!isToken(token)) return { ok: false, reason: "missing" };
  const row = await store.find(await hashToken(token));
  if (!row || row.kind !== "link") return { ok: false, reason: "missing" };
  const state = linkState(row, now);
  if (state !== "ok") return { ok: false, reason: state };
  if (!(await store.markUsed(row.id, now.toISOString()))) return { ok: false, reason: "used" };
  return { ok: true, listing_id: row.listing_id };
}

export async function sessionFor(store, token, now) {
  if (!isToken(token)) return null;
  const row = await store.find(await hashToken(token));
  if (!row || row.kind !== "session" || linkState(row, now) !== "ok") return null;
  return row.listing_id;
}

// ---------- fields ----------
export function parseSounds(raw) {
  let list = raw;
  if (typeof raw === "string") {
    try { const j = JSON.parse(raw); list = Array.isArray(j) ? j : raw.split(","); } catch { list = raw.split(","); }
  }
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const hit = SOUNDS.find((x) => x.toLowerCase() === cleanText(s, 20).toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out.slice(0, 3);
}

export function cleanHandle(raw) {
  const h = cleanText(raw, 60).replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : "";
}

export function parseAge(raw) {
  const v = cleanText(raw, 12).toLowerCase().replace("+", "").replace(/\s/g, "");
  return v === "all" || v === "allages" ? "all" : v === "18" ? "18" : v === "21" ? "21" : null;
}

const chicagoParts = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

// "2027-01-09T21:30" typed in Chicago time -> a UTC ISO string, or "" when it is not a real time.
export function chicagoLocalToIso(raw) {
  const s = cleanText(raw, 16);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return "";
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  for (const off of [5, 6]) {
    const guess = new Date(Date.UTC(y, mo - 1, d, h + off, mi));
    if (!Number.isNaN(guess.getTime()) && chicagoParts(guess) === s) return guess.toISOString();
  }
  return "";
}

const yes = (v) => ["1", "true", "on", "yes"].includes(cleanText(v, 8).toLowerCase());

// Everything a submitter types goes through here. Returns { error } or { data }.
export function readShow(f, today) {
  const name = cleanText(f.name, 120);
  const when = cleanText(f.date, 10);
  const venue = cleanText(f.venue, 120);
  const place = listingPlace(f.city, f.state);
  const ticket = normTicketUrl(f.ticket_url);
  if (!name) return { error: "Add the show name." };
  if (!dateOk(when, today)) return { error: "Add a date that is today or later." };
  if (!place.city) return { error: "Add the city." };
  if (!MIDWEST.includes(place.state)) return { error: "Pick a Midwest state." };
  if (!venue) return { error: "Add the venue." };
  if (!ticket) return { error: "Add a ticket link that starts with https." };
  const secret = yes(f.venue_secret);
  const reveal = secret ? chicagoLocalToIso(f.secret_reveal) : "";
  if (secret && cleanText(f.secret_reveal, 16) && !reveal) return { error: "That reveal time doesn't look right." };
  const src = cleanText(f.source, 8);
  return {
    data: {
      name, show_date: when, venue, city: place.city, state: place.state, ticket_url: ticket,
      price: cleanText(f.price, 60) || null,
      lineup: cleanText(f.lineup, 600) || null,
      sounds: parseSounds(f.sounds),
      artist_socials: cleanText(f.artist_socials, 300) || null,
      promoter_ig: cleanHandle(f.promoter_ig) || null,
      age: parseAge(f.age),
      venue_secret: secret,
      secret_reveal_at: reveal || null,
      source: ["link", "flyer", "manual"].includes(src) ? src : "manual",
    },
  };
}

// ---------- ticket-link parsing ----------
const HOSTS = { "posh.vip": "Posh", "eventbrite.com": "Eventbrite", "dice.fm": "DICE", "ra.co": "RA" };

// Only these sites are ever fetched. Anything else gets typed in by hand.
export function ticketSite(raw) {
  const url = normTicketUrl(raw);
  if (!url) return "";
  const host = new URL(url).hostname.toLowerCase();
  for (const d of Object.keys(HOSTS)) if (host === d || host.endsWith("." + d)) return HOSTS[d];
  return "";
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function unent(s) {
  return String(s ?? "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

function metaTags(html) {
  const out = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (key && val != null && !(key.toLowerCase() in out)) out[key.toLowerCase()] = unent(val);
  }
  return out;
}

function eventNodes(html) {
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const t = [].concat(n["@type"] || []).join(" ");
    if (/Event/i.test(t)) found.push(n);
    if (n["@graph"]) walk(n["@graph"]);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { /* a broken block is skipped */ }
  }
  return found;
}

function stateCode(raw) {
  const s = cleanText(raw, 40);
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const hit = Object.entries(STATE_NAME).find(([, n]) => n.toLowerCase() === s.toLowerCase());
  return hit ? hit[0] : "";
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

// html + page url -> { fields, from }. Never throws. A page with nothing usable gives empty fields.
// `from` says where each prefilled value came from, shown next to the field.
export function parseEvent(html, pageUrl) {
  const site = ticketSite(pageUrl) || "ticket page";
  const fields = {};
  const from = {};
  const put = (k, v, src) => {
    const t = cleanText(unent(v), k === "lineup" ? 600 : 120);
    if (t && !fields[k]) { fields[k] = t; from[k] = src; }
  };
  try {
    const src = String(html || "").slice(0, 600000);
    const ev = eventNodes(src)[0];
    if (ev) {
      const label = site + " page";
      put("name", ev.name, label);
      const start = cleanText(ev.startDate, 40);
      if (/^\d{4}-\d{2}-\d{2}/.test(start)) { fields.date = start.slice(0, 10); from.date = label; }
      const loc = first(ev.location);
      if (loc && typeof loc === "object") {
        put("venue", loc.name, label);
        const a = loc.address;
        if (a && typeof a === "object") {
          put("city", a.addressLocality, label);
          const st = stateCode(a.addressRegion);
          if (st) { fields.state = st; from.state = label; }
        }
      }
      const people = [].concat(ev.performer || []).map((p) => (typeof p === "string" ? p : p && p.name)).filter(Boolean);
      if (people.length) put("lineup", people.join(", "), label);
      const offer = first(ev.offers);
      if (offer && typeof offer === "object") {
        const p = offer.lowPrice ?? offer.price;
        if (p !== undefined && p !== "" && !Number.isNaN(Number(p))) {
          const cur = cleanText(offer.priceCurrency, 3).toUpperCase();
          put("price", (offer.lowPrice !== undefined ? "From " : "") + (cur === "USD" || !cur ? "$" : cur + " ") + Number(p), label);
        }
      }
      const img = first(ev.image);
      const imgUrl = typeof img === "string" ? img : img && img.url;
      if (typeof imgUrl === "string" && /^https:\/\//.test(imgUrl)) fields.flyer_url = imgUrl.slice(0, 400);
    }
    const meta = metaTags(src);
    const title = (src.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    put("name", meta["og:title"] || meta["twitter:title"] || title, site + " page title");
    if (!fields.flyer_url && /^https:\/\//.test(meta["og:image"] || "")) fields.flyer_url = meta["og:image"].slice(0, 400);
  } catch { /* fall through with whatever was found */ }
  if (fields.flyer_url) from.flyer_url = site + " page";
  return { fields, from, site };
}

// Hook for reading text off an uploaded flyer. Needs OCR, which is a paid service, so it is off for now.
// When one is chosen, return { name, date, venue, lineup } from here and the check step will prefill and label it.
export function flyerHints(_bytes) { return {}; }

// ---------- views ----------
// What Dylan sees. The only place besides the owner's own page that carries venue and lineup.
export function reviewExtras(row) {
  return {
    status: row.status,
    was_live: !!row.was_live,
    lineup: row.lineup || "",
    price: row.price || "",
    sounds: row.sounds || [],
    artist_socials: row.artist_socials || "",
    promoter_ig: row.promoter_ig || "",
    age: row.age ? AGES[row.age] : "",
    secret_reveal_at: row.secret_reveal_at || "",
    source: row.source || "",
  };
}

// The owner's own page, behind their edit session. Promo kit is locked until Dylan approves.
export function ownerView(row, flyerUrl, siteUrl, cityPathFn) {
  const live = row.status === "approved";
  const stage = row.status === "approved" ? "live" : row.status === "rejected" ? "rejected" : "review";
  return {
    id: row.id,
    stage,
    was_live: !!row.was_live,
    name: row.name, date: String(row.show_date || "").slice(0, 10), venue: row.venue || "", city: row.city, state: row.state,
    ticket_url: row.ticket_url, price: row.price || "", lineup: row.lineup || "", sounds: row.sounds || [],
    artist_socials: row.artist_socials || "", promoter_ig: row.promoter_ig || "", age: row.age || "",
    venue_secret: !!row.venue_secret, secret_reveal_at: row.secret_reveal_at || "",
    flyer: flyerUrl(row.flyer_path), public_flyer: flyerUrl(row.public_flyer_path),
    kit: live
      ? { locked: false, share_url: siteUrl + "/shows/" + cityPathFn(row.city, row.state), story_flyer: flyerUrl(row.flyer_path) }
      : { locked: true },
  };
}

// ---------- mail ----------
// The signature and mailing address are added by the sender, so they are never missing.
export function linkMail({ name, url }) {
  const lines = [
    "Your link to edit " + name + " on Subduction:",
    "",
    url,
    "",
    "It opens once and stops working after " + LINK_DAYS + " days. You can ask for a new one any time at " + url.replace(/\?.*$/, "") + ".",
    "Anything you change while it's in review is free. A change to a live show goes back for a look first.",
    "",
    "You get this because you sent a show in. To stop these, reply with the word stop.",
  ];
  return { subject: "Your link to edit " + name, text: lines.join("\n"), fromName: "Subduction", tag: "directory-link" };
}

export function newLinkMail({ shows, base }) {
  const lines = ["Here are your links to edit your shows on Subduction:", ""];
  for (const s of shows) lines.push(s.name + "\n" + base + "?k=" + s.token + "\n");
  lines.push("Each opens once and stops working after " + LINK_DAYS + " days.", "", "You get this because someone asked for a link for this email. If it wasn't you, ignore it. To stop these, reply with the word stop.");
  return { subject: "Your Subduction edit link", text: lines.join("\n"), fromName: "Subduction", tag: "directory-link" };
}

export const UNSUB_HEADER = "<mailto:hello@subduction.art?subject=stop>";
