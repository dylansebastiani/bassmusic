// Copies site/ to dist/ and injects config + public env into each page.
// Public env (safe to ship to the browser): SUPABASE_URL, TURNSTILE_SITE_KEY.
// The deploy workflow (.github/workflows/pages.yml) runs `npm run build` with these set.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const root = new URL("..", import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(join(root, "config/stack.json"), "utf8"));
const pub = {
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || "",
  siteUrl: (process.env.SITE_URL || cfg.siteUrl || "").replace(/\/$/, ""),
};
if (!pub.supabaseUrl) console.warn("build: SUPABASE_URL is not set; the form will not submit.");
if (!pub.turnstileSiteKey) console.warn("build: TURNSTILE_SITE_KEY is not set; bot check is off.");

const out = join(root, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "site"), out, { recursive: true });

const inject = `<script>window.STACK=${JSON.stringify({ ...cfg, ...pub })};</script>`;
const PLAYER = '<script src="/assets/player.js" defer></script>';
const rawT = readFileSync(join(out, "t.html"), "utf8");
for (const f of readdirSync(out)) {
  if (!f.endsWith(".html")) continue;
  const p = join(out, f);
  // The music bar rides along on every public page. Staff pages (door, admin, people) stay quiet.
  // The homepage is promoter-first, so it stays quiet too, except for fans arriving from a show QR or friend link.
  const bar = /^(door|admin|studio|promoter|demo|pass|people|shows-review)\.html$/.test(f) ? ""
    : f === "index.html" ? '<script>if(/[?&](e|r|src)=/.test(location.search)){var s=document.createElement("script");s.src="/assets/player.js";s.defer=true;document.head.appendChild(s);}</script>'
    : PLAYER;
  // Every script and stylesheet link gets ?v=<content hash>, so a page and its code always update together
  // (otherwise a phone can pair a fresh page with a cached old script and the form breaks).
  const html = readFileSync(p, "utf8").replace("<!--CONFIG-->", inject + bar)
    .replace(/(src|href)="(\/?assets\/[^"?#]+\.(?:js|css))"/g, (m, attr, path) => {
      try { return `${attr}="${path}?v=${createHash("sha256").update(readFileSync(join(out, path.replace(/^\//, "")))).digest("hex").slice(0, 10)}"`; }
      catch { return m; }
    });
  writeFileSync(p, html);
}
// /underground/ is the event page itself (not a redirect), so link previews in iMessage,
// Instagram and Facebook read its cover image and title. <base> keeps its asset paths working.
mkdirSync(join(out, "underground"), { recursive: true });
writeFileSync(join(out, "underground", "index.html"),
  readFileSync(join(out, "tickets.html"), "utf8").replace("<head>", '<head>\n<base href="/">'));
// Any address that isn't a file falls back to the show page, which reads the show from the address:
// subduction.art/<slug> works the moment a show is published, before the next rebuild gives it its own page below.
writeFileSync(join(out, "404.html"), readFileSync(join(out, "show.html"), "utf8").replace("<head>", '<head>\n<base href="/">'));
// Pretty routes and the short links used in emails (/c/<token>, /u/<token>).
const fn = pub.supabaseUrl + "/functions/v1";
writeFileSync(join(out, "_redirects"), [
  "/in /in.html 200",
  "/bonus /bonus.html 200",
  "/collection /collection.html 200",
  "/t /t.html 200",
  "/admin /admin.html 200",
  "/privacy /privacy.html 200",
  "/tickets /tickets.html 200",
  "/show /show.html 200",
  "/studio /studio.html 200",
  "/promoter /promoter.html 200",
  "/ticket /ticket.html 200",
  "/door /door.html 200",
  "/shows/review /shows-review.html 200",
  "/shows /shows.html 200",
  "/shows/ /shows.html 200",
  "/shows/:city /shows.html 200",
  `/c/:token ${fn}/confirm?t=:token 302`,
  `/u/:token ${fn}/unsubscribe?u=:token 302`,
  "",
].join("\n"));
writeFileSync(join(out, "_headers"), [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  X-Frame-Options: DENY",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Permissions-Policy: camera=(self), microphone=(), geolocation=()",
  `  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://js.stripe.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://*.supabase.co; media-src 'self' blob: https://*.supabase.co; connect-src 'self' ${pub.supabaseUrl || "https://*.supabase.co"} https://api.stripe.com; frame-src https://challenges.cloudflare.com https://js.stripe.com https://*.stripe.com; base-uri 'none'; form-action 'self'`,
  "",
].join("\n"));
// One page per live track at /t/<CODE>/: the same sticker page, with the song, the artist and
// the cover in the preview tags, so a pasted link shows what it is. The list comes from the
// backend at build time; if it can't be reached the build still succeeds without these pages.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Width and height from a JPEG's own header, so the preview tags tell the truth.
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}
// Every approved, published promoter show gets its own page at /<slug>/ (a real page, so link previews
// in iMessage, Instagram and Facebook show the show's own name and image). The list already leaves out
// anything that isn't approved; the check below is a second lock on the title and share image.
async function showPages() {
  if (!pub.supabaseUrl || /example\.supabase\.co/.test(pub.supabaseUrl)) return;
  let shows = [];
  try { shows = (await (await fetch(`${fn}/shows`, { signal: AbortSignal.timeout(15000) })).json()).shows || []; }
  catch (e) { console.warn("build: could not fetch the show list, short links fall back to the 404 page:", e.message); return; }
  const base = readFileSync(join(out, "show.html"), "utf8").replace("<head>", '<head>\n<base href="/">');
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let n = 0;
  for (const s of shows) {
    if (!/^[a-z0-9-]{1,80}$/.test(s.slug || "")) continue;
    if (s.review_status && s.review_status !== "approved") { console.warn(`build: show "${s.slug}" is not approved, skipped`); continue; }
    // Never let a show's name shadow a real page or folder of the site.
    if (existsSync(join(out, s.slug)) || existsSync(join(out, s.slug + ".html"))) { console.warn(`build: show "${s.slug}" clashes with a site page, skipped`); continue; }
    const tags = `<title>${esc(s.name)}</title>\n<meta property="og:title" content="${esc(s.name)}">\n<meta property="og:url" content="${pub.siteUrl}/${s.slug}">` +
      (s.share_url ? `\n<meta property="og:image" content="${esc(s.share_url)}">\n<meta name="twitter:card" content="summary_large_image">` : "");
    mkdirSync(join(out, s.slug), { recursive: true });
    writeFileSync(join(out, s.slug, "index.html"), base.replace('<meta property="og:type" content="website">', '<meta property="og:type" content="website">\n' + tags));
    n++;
  }
  console.log(`built ${n} show page(s)`);
}
// Artist short links (subduction.art/go/<tag>) get a tiny real page that hands off to the tap counter, which
// then forwards to the show with ?ref=<tag>. Links made between builds still work through the 404 page.
async function goPages() {
  if (!pub.supabaseUrl || /example\.supabase\.co/.test(pub.supabaseUrl)) return;
  let refs = [];
  try { refs = (await (await fetch(`${fn}/artist-sales?a=refs`, { signal: AbortSignal.timeout(15000) })).json()).refs || []; }
  catch (e) { console.warn("build: could not fetch artist links, /go/ falls back to the 404 page:", e.message); return; }
  let n = 0;
  for (const r of refs) {
    if (!/^[a-z0-9]{1,24}$/.test(r)) continue;
    const to = `${fn}/artist-sales?go=${r}`;
    mkdirSync(join(out, "go", r), { recursive: true });
    writeFileSync(join(out, "go", r, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Get tickets</title><meta property="og:title" content="Get tickets"><meta property="og:image" content="${pub.siteUrl}/assets/og.jpg">
<meta http-equiv="refresh" content="0;url=${to}"><script>location.replace(${JSON.stringify(to)});</script></head>
<body style="background:#050505;color:#fff;font:16px Arial,sans-serif;text-align:center;padding:40px"><a href="${to}" style="color:#F2C14E">Get tickets</a></body></html>`);
    n++;
  }
  console.log(`built ${n} artist link page(s)`);
}
async function trackPages() {
  if (!pub.supabaseUrl || /example\.supabase\.co/.test(pub.supabaseUrl)) return;
  let tracks = [];
  try {
    const r = await fetch(`${fn}/track?list=1`, { signal: AbortSignal.timeout(15000) });
    tracks = (await r.json()).tracks || [];
  } catch (e) { console.warn("build: could not fetch the track list, no per-track preview pages:", e.message); return; }
  const base = rawT
    .replace(/(href|src)="assets\//g, '$1="/assets/').replace('href="privacy.html"', 'href="/privacy"');
  mkdirSync(join(out, "assets/drops"), { recursive: true });
  let n = 0;
  for (const t of tracks) {
    if (!/^[A-Z0-9]{6,12}$/.test(t.code || "")) continue;
    let image = `${pub.siteUrl}/assets/og-track.jpg`, w = 1200, h = 630;
    if (t.artwork_url) {
      try {
        let buf = Buffer.from(await (await fetch(t.artwork_url, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
        // Re-encode to a plain 1200px baseline JPEG: every crawler reads that, whatever the upload was.
        try { const sharp = (await import("sharp")).default; buf = await sharp(buf).rotate().resize(1200, 1200, { fit: "cover" }).jpeg({ quality: 86, progressive: false }).toBuffer(); }
        catch (e) { console.warn("build: sharp unavailable, using the cover as uploaded:", e.message); }
        // The file name carries a fingerprint, so a new cover is a new link and never a stale cached one.
        const tag = createHash("sha1").update(buf).digest("hex").slice(0, 8);
        writeFileSync(join(out, "assets/drops", `share-${t.code}-${tag}.jpg`), buf);
        image = `${pub.siteUrl}/assets/drops/share-${t.code}-${tag}.jpg`; [w, h] = jpegSize(buf) || [0, 0];
      } catch (e) { console.warn("build: cover for", t.code, "skipped:", e.message); }
    }
    const title = `${t.title}${t.artist ? " by " + t.artist : ""}`;
    const desc = "An unreleased track from Subduction. Drop your email and it goes straight into your collection. Free.";
    let html = base.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`)
      .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(image)}">`)
      .replace(/<meta property="og:image:width" content="[^"]*"><meta property="og:image:height" content="[^"]*">/, w && h ? `<meta property="og:image:width" content="${w}"><meta property="og:image:height" content="${h}">` : "")
      .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(title)}">`)
      .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(desc)}">`)
      .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${esc(image)}">`)
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace("<!--CONFIG-->", `<script>window.__QR=${JSON.stringify(t.code)};</script>` + inject + PLAYER);
    mkdirSync(join(out, "t", t.code), { recursive: true });
    writeFileSync(join(out, "t", t.code, "index.html"), html);
    n++;
  }
  console.log("built", n, "track preview pages");
}
// One page per city that already has an upcoming show, so a link like /shows/peoria-il
// has its own title. If the directory function is not up yet, the main /shows page still works.
const DIR_STATE = { IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", MI: "Michigan", MN: "Minnesota", MO: "Missouri", NE: "Nebraska", ND: "North Dakota", OH: "Ohio", SD: "South Dakota", WI: "Wisconsin" };
async function directoryPages() {
  if (!pub.supabaseUrl || /example\.supabase\.co/.test(pub.supabaseUrl)) return;
  let shows = [];
  try { shows = (await (await fetch(`${fn}/directory`, { signal: AbortSignal.timeout(15000) })).json()).shows || []; }
  catch (e) { console.warn("build: could not fetch the show directory, city pages wait for the next build:", e.message); return; }
  const baseHtml = readFileSync(join(out, "shows.html"), "utf8");
  const by = {};
  for (const s of shows) {
    if (!/^[a-z0-9-]{1,48}$/.test(s.path || "") || s.path === "review") continue;
    (by[s.path] ||= []).push(s);
  }
  let n = 0;
  for (const path of Object.keys(by)) {
    const list = by[path];
    const sample = list[0];
    const where = [sample.city, DIR_STATE[sample.state] || sample.state].filter(Boolean).join(", ");
    const title = where ? `Bass shows in ${where}` : "Midwest bass shows";
    const desc = where ? `Upcoming bass shows in ${where}.` : "Upcoming bass shows across the Midwest, by city and date.";
    const pageUrl = `${pub.siteUrl}/shows/${path}`;
    const cards = list.map((s) => {
      const href = esc(s.url);
      const own = s.source === "subduction";
      const ext = /^https:\/\//.test(s.url || "");
      const img = s.flyer ? `<img class="art" src="${esc(s.flyer)}" alt="">` : "";
      const tag = `<span class="tickets">${own ? "Tickets here<small>$1.50 fee</small>" : "Tickets"}</span>`;
      const frame = img ? `<span class="frame">${img}${tag}</span>` : `<span class="frame blank">${tag}</span>`;
      // A secret location never prints the venue name, here or anywhere else on the page.
      const venue = s.secret ? "Secret location" : (s.venue || "");
      const city = [s.city, s.state].filter(Boolean).join(", ");
      const names = (s.lineup || []).length ? `<span class="lineup">${esc(s.lineup.join(", "))}</span>` : "";
      return `<article class="cell"><a class="poster${img ? "" : " noart"}" href="${href}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ""}>${frame}<span class="meta"><span class="when">${esc(s.when || "")}${s.fresh ? ' <span class="new">Just added</span>' : ""}</span><h3>${esc(s.name)}</h3>${venue ? `<span class="venue">${esc(venue)}</span>` : ""}<span class="city">${esc(city)}</span>${names}</span></a></article>`;
    }).join("");
    let html = baseHtml
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace('<p class="kick" id="kick">Midwest</p>', `<p class="kick" id="kick">${esc(where || "Midwest")}</p>`)
      .replace('<h1 class="disp" id="title">Bass <em>shows.</em></h1>', `<h1 class="disp" id="title">${esc(sample.city || "Bass")} <em>shows.</em></h1>`)
      .replaceAll("Upcoming bass shows across the Midwest, by city and date.", desc)
      .replaceAll("https://subduction.art/shows", pageUrl)
      .replace(/<div id="list" class="wall">[\s\S]*?<\/div>/, () => `<div id="list" class="wall">${cards}</div>`)
      .replace(/(<script src="\/assets\/shows\.js[^"]*"><\/script>)/, `<script>window.__SHOWS_CITY=${JSON.stringify(path)};</script>\n$1`);
    if (!html.includes("<base ")) html = html.replace("<head>", '<head>\n<base href="/">');
    mkdirSync(join(out, "shows", path), { recursive: true });
    writeFileSync(join(out, "shows", path, "index.html"), html);
    n++;
  }
  console.log(`built ${n} city page(s)`);
}
await trackPages();
await showPages();
await goPages();
await directoryPages();
console.log("built dist/ with", Object.keys(cfg).length, "config keys");
