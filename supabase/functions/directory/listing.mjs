// Pure rules for the public show directory. No database, no mail, no Deno APIs.
// The directory function and the node test both import this file.

export const MIDWEST = ["IL", "IN", "IA", "KS", "MI", "MN", "MO", "NE", "ND", "OH", "SD", "WI"];

export const STATE_NAME = {
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", MI: "Michigan", MN: "Minnesota",
  MO: "Missouri", NE: "Nebraska", ND: "North Dakota", OH: "Ohio", SD: "South Dakota", WI: "Wisconsin",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export function cleanText(v, max) {
  return String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function splitPlace(raw) {
  const s = cleanText(raw, 80);
  const m = s.match(/^(.*?)(?:,\s*|\s+)([A-Za-z]{2})$/);
  if (m && m[1].trim()) return { city: m[1].trim(), state: m[2].toUpperCase() };
  return { city: s, state: "" };
}

export function citySlug(city) {
  return cleanText(city, 80).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// peoria-il, so two cities with the same name stay apart.
export function cityPath(city, state) {
  const c = citySlug(city);
  const s = cleanText(state, 2).toLowerCase();
  if (!c || c === "review") return "";
  return s ? c + "-" + s : c;
}

export function chicagoYmd(iso) {
  const d = iso instanceof Date ? iso : new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function dateOk(ymd, today) {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd || "") && ymd >= today && ymd <= addDays(today, 550);
}

export function formatDay(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d, 12))).replace(/,/g, "");
}

export function whenLabel(dates) {
  const labels = (dates || []).map(formatDay).filter(Boolean);
  if (labels.length <= 1) return labels[0] || "";
  if (labels.length === 2) return labels[0] + " + " + labels[1];
  return labels[0] + " through " + labels[labels.length - 1];
}

// T.O.F.T.U. keeps its own address. Every other ticketed show uses the public show path.
export function ticketLink(slug) {
  if (slug === "underground") return "/underground/";
  return "/" + slug;
}

export function honeypotFilled(body) {
  const b = body || {};
  return !!(cleanText(b.hp_field, 200) || cleanText(b.website, 200) || cleanText(b.company, 200));
}

export function normTicketUrl(raw) {
  const s = cleanText(raw, 400);
  if (!s) return "";
  let u;
  try { u = new URL(s); } catch { return ""; }
  if (u.protocol !== "https:") return "";
  if (!u.hostname || u.username || u.password) return "";
  u.hash = "";
  return u.toString().slice(0, 400);
}

export function listingPlace(city, state) {
  const parsed = splitPlace(city);
  const st = cleanText(state, 2).toUpperCase() || parsed.state;
  return { city: parsed.city, state: st };
}

function upcomingDates(values, today) {
  const out = [];
  for (const v of values) {
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : chicagoYmd(v);
    if (ymd && ymd >= today && !out.includes(ymd)) out.push(ymd);
  }
  out.sort();
  return out;
}

// An approved show that is actually on sale, or already has a public page.
// Past nights drop off. A secret location never contributes a street or a venue name.
export function subductionCard(ev, nights, today) {
  if (!ev || ev.review_status !== "approved") return null;
  if (ev.is_active === false || ev.is_public === false) return null;
  if (!ev.sales_open && !ev.page_published_at) return null;
  if (!/^[a-z0-9-]{1,80}$/.test(ev.slug || "")) return null;
  const fromNights = (nights || []).map((n) => n && n.starts_at).filter(Boolean);
  const dates = upcomingDates(fromNights.length ? fromNights : [ev.starts_at], today);
  if (!dates.length) return null;
  const place = splitPlace(ev.city);
  const secret = !!ev.location_secret;
  let flyer = "";
  if (ev.slug === "underground") flyer = "/assets/toftu/poster-fri.webp";
  else if (typeof ev.share_url === "string" && /^https:\/\//.test(ev.share_url)) flyer = ev.share_url;
  else if (typeof ev.poster_url === "string" && /^https:\/\//.test(ev.poster_url)) flyer = ev.poster_url;
  return {
    source: "subduction",
    slug: ev.slug,
    name: cleanText(ev.name, 120) || "Show",
    dates,
    when: whenLabel(dates),
    venue: secret ? "" : cleanText(ev.venue, 120),
    secret,
    city: place.city,
    state: place.state,
    url: ticketLink(ev.slug),
    flyer,
  };
}

export function externalCard(row, today) {
  if (!row || row.status !== "approved") return null;
  const dates = upcomingDates([row.show_date], today);
  if (!dates.length) return null;
  const url = normTicketUrl(row.ticket_url);
  if (!url) return null;
  return {
    source: "listing",
    slug: "",
    name: cleanText(row.name, 120) || "Show",
    dates,
    when: whenLabel(dates),
    venue: cleanText(row.venue, 120),
    secret: false,
    city: cleanText(row.city, 80),
    state: cleanText(row.state, 2).toUpperCase(),
    url,
    flyer: typeof row.flyer_url === "string" && /^https:\/\//.test(row.flyer_url) ? row.flyer_url : "",
  };
}

export function publicCard(card) {
  return {
    source: card.source,
    name: card.name,
    when: card.when,
    dates: card.dates,
    venue: card.venue,
    secret: card.secret,
    city: card.city,
    state: card.state,
    url: card.url,
    flyer: card.flyer || "",
    path: cityPath(card.city, card.state),
  };
}

export function matches(show, q) {
  const f = q || {};
  if (f.state && show.state !== f.state) return false;
  if (f.path && show.path !== f.path && cityPath(show.city, show.state) !== f.path) return false;
  if (f.date && !(show.dates || []).includes(f.date)) return false;
  if (f.q) {
    const hay = (show.name + " " + show.venue + " " + show.city + " " + show.state).toLowerCase();
    if (!hay.includes(String(f.q).toLowerCase().trim())) return false;
  }
  return true;
}

// Dylan's note. The submitter is never a recipient. replyTo is set by the caller, and only when
// that address is not an artist contact.
export function leadMail(show) {
  const lines = [
    "New show listing",
    "",
    "Show: " + show.name,
    "Date: " + show.when,
    "Venue: " + (show.venue || "Secret location"),
    "City: " + [show.city, show.state].filter(Boolean).join(", "),
    "Tickets: " + show.ticket_url,
    "From: " + show.from,
    "",
    "Open it: " + show.review_url,
  ];
  return {
    subject: ("New show listing: " + show.name).slice(0, 140),
    text: lines.join("\n"),
    fromName: "Subduction leads",
    tag: "lead",
  };
}

export function alertRecipients(admins, submitter, artistOf) {
  const sub = String(submitter || "").toLowerCase().trim();
  const to = [];
  for (const raw of admins || []) {
    const email = String(raw || "").toLowerCase().trim();
    if (!EMAIL_RE.test(email) || email === sub || to.includes(email)) continue;
    if (artistOf(email) !== false) continue;
    to.push(email);
  }
  return to;
}

export function canReplyTo(submitter, artistOf) {
  const email = String(submitter || "").toLowerCase().trim();
  return EMAIL_RE.test(email) && artistOf(email) === false;
}
