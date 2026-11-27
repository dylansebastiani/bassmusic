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


// ---- Ad and analytics tags (Meta Pixel, Google Analytics, TikTok Pixel) ----
// Two separate sets of IDs. Only pages on the lists below get a snippet; every other page gets nothing.
const TAGS = {
  subduction: { full: true, meta: "2127463657899244", ga: "G-X6VM4P4QXW", tt: "DC4UH0RC77U703IGPCMG" },
  toftu: { full: false, meta: "1459347406264279", ga: "G-1062B0ZQEK", tt: "DC4UIFRC77U0A5LSPRQG" },
};
const TAG_PAGES = { "index.html": "subduction", "artists.html": "subduction", "fees.html": "subduction", "privacy.html": "subduction",
  "terms.html": "subduction", "show.html": "subduction", "t.html": "subduction", "tickets.html": "toftu" };
function trackingSnippet(kind) {
  const P = TAGS[kind];
  if (!P) return "";
  const cfg = JSON.stringify({ m: P.meta, g: P.ga, t: P.tt });
  const src = String.raw`(function(){
var P=__CFG__,FULL=__FULL__,T=window.Trk={};
try{if(localStorage.getItem("stack_admin"))return}catch(e){}
var q=new URLSearchParams(location.search),first=location.pathname.split("/")[1]||"";
if(q.get("preview")==="1"||q.get("test")==="1")return;
if(FULL&&(first==="underground"||q.get("e")==="underground"))return;
var OK={e:1,ref:1,src:1,utm_source:1,utm_medium:1,utm_campaign:1,utm_content:1,utm_term:1,fbclid:1,gclid:1,ttclid:1};
function bad(k,v){return !OK[k]||/@|cs_/i.test(v)}
function isClean(){var ok=true;q.forEach(function(v,k){if(bad(k,v))ok=false});
if(/[=@]/.test(location.hash))ok=false;
if(document.referrer.indexOf(location.origin)===0&&/[?#]/.test(document.referrer))ok=false;return ok}
function cleanUrl(){var u=new URLSearchParams();q.forEach(function(v,k){if(!bad(k,v))u.append(k,v)});var s=u.toString();return location.origin+location.pathname+(s?"?"+s:"")}
var ref=document.referrer;if(ref.indexOf(location.origin)===0)ref=location.origin+ref.slice(location.origin.length).split(/[?#]/)[0];
var slug=(first&&!/\./.test(first)?first:q.get("e")||"").replace(/[^a-z0-9-]/gi,"").toLowerCase()||"show";
var gOn=false,pOn=false;
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag("js",new Date());
gtag("config",P.g,{send_page_view:false,allow_ad_personalization_signals:false});
gtag("event","page_view",{page_location:cleanUrl(),page_referrer:ref,page_title:document.title});
var gs=document.createElement("script");gs.async=true;gs.src="https://www.googletagmanager.com/gtag/js?id="+P.g;document.head.appendChild(gs);gOn=true;
T.pix=function(){
if(pOn||!isClean())return;pOn=true;
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");
fbq("set","autoConfig",false,P.m);fbq("init",P.m);fbq("track","PageView");
!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var s=d.createElement("script");s.type="text/javascript";s.async=!0;s.src=r+"?sdkid="+e+"&lib="+t;var x=d.getElementsByTagName("script")[0];x.parentNode.insertBefore(s,x)};ttq.load(P.t);ttq.page()}(window,document,"ttq");
};
T.pix();
if(FULL){
T.view=function(){if(!pOn){gtag("event","view_item",{items:[{item_id:slug,item_name:slug}]});return}
fbq("track","ViewContent",{content_type:"product",content_ids:[slug],content_name:slug});
ttq.track("ViewContent",{content_type:"product",content_id:slug,content_name:slug});
gtag("event","view_item",{items:[{item_id:slug,item_name:slug}]})};
T.checkout=function(){if(pOn){fbq("track","InitiateCheckout",{content_type:"product",content_ids:[slug]});ttq.track("InitiateCheckout",{content_type:"product",content_id:slug})}
gtag("event","begin_checkout",{items:[{item_id:slug,item_name:slug}]})};
T.purchase=function(cents){var v=Math.round(Number(cents)||0)/100;
if(pOn){fbq("track","Purchase",{value:v,currency:"USD"});ttq.track("CompletePayment",{value:v,currency:"USD"})}
gtag("event","purchase",{value:v,currency:"USD"})};
}
})();`.replace("__CFG__", cfg).replace("__FULL__", String(P.full));
  return `<script>${src}</script>`;
}

const TAG_SCRIPT = "https://connect.facebook.net https://www.googletagmanager.com https://analytics.tiktok.com";
const TAG_IMG = "https://www.facebook.com https://www.google-analytics.com https://www.googletagmanager.com https://analytics.tiktok.com";
const TAG_CONNECT = "https://www.facebook.com https://connect.facebook.net https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://analytics.tiktok.com";
const inject = `<script>window.STACK=${JSON.stringify({ ...cfg, ...pub })};</script>`;
const PLAYER = '<script src="/assets/player.js" defer></script>';
const rawT = readFileSync(join(out, "t.html"), "utf8");
for (const f of readdirSync(out)) {
  if (!f.endsWith(".html")) continue;
  const p = join(out, f);
  // The music bar rides along on every public page. Staff pages (door, admin, people) stay quiet.
  // The homepage is promoter-first, so it stays quiet too, except for fans arriving from a show QR or friend link.
  const bar = /^(door|admin|studio|promoter|demo|pass|people|fees|artists)\.html$/.test(f) ? ""
    : f === "index.html" ? '<script>if(/[?&](e|r|src)=/.test(location.search)){var s=document.createElement("script");s.src="/assets/player.js";s.defer=true;document.head.appendChild(s);}</script>'
    : PLAYER;
  // Every script and stylesheet link gets ?v=<content hash>, so a page and its code always update together
  // (otherwise a phone can pair a fresh page with a cached old script and the form breaks).
  const html = readFileSync(p, "utf8").replace("<!--CONFIG-->", () => inject + bar + trackingSnippet(TAG_PAGES[f]))
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
// Inline the public tickets GET so nights and prices paint instantly; the page refreshes from the live GET.
// A failure here never fails the build; the page just ships without #evt-data.
try {
  if (!pub.supabaseUrl) throw new Error("no SUPABASE_URL");
  const r = await fetch(`${pub.supabaseUrl}/functions/v1/tickets?e=underground`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (!r.ok || !j || !j.event || !j.nights || !j.types) throw new Error("bad response");
  const snap = { event: j.event, nights: j.nights, types: j.types, stripe_key: j.stripe_key };
  const tag = `<script id="evt-data" type="application/json">${JSON.stringify(snap).replace(/</g, "\\u003c")}</script>`;
  const ugPath = join(out, "underground", "index.html"), ugHtml = readFileSync(ugPath, "utf8");
  const at = ugHtml.indexOf('<script src="assets/tickets.js'); // must sit before the script that reads it
  if (at < 0) throw new Error("tickets.js tag not found");
  writeFileSync(ugPath, ugHtml.slice(0, at) + tag + "\n" + ugHtml.slice(at));
} catch (e) { console.warn("build: /underground/ ships without inlined tickets:", e.message); }
// Any address that isn't a file falls back to the show page, which reads the show from the address:
// subduction.art/<slug> works the moment a show is published, before the next rebuild gives it its own page below.
writeFileSync(join(out, "404.html"), readFileSync(join(out, "show.html"), "utf8").replace("<head>", '<head>\n<base href="/">'));
// GitHub Pages ignores _redirects, so these folder addresses get a tiny stub that hands off to the real page,
// keeping any ?query and #hash. A show named after one of these folders is skipped by the slug-clash check in showPages().
const stubs = [["artists", "/artists.html"], ["promoter", "/promoter.html"], ["account", "/me.html"], ["login", "/me.html"], ["signin", "/me.html"]];
for (const [dir, to] of stubs) {
  mkdirSync(join(out, dir), { recursive: true });
  writeFileSync(join(out, dir, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${to}"><script>location.replace(${JSON.stringify(to)} + location.search + location.hash);</script></head>
<body style="background:#050505;color:#F4F1EE;font:16px Arial,sans-serif;text-align:center;padding:40px"><a href="${to}" style="color:#F4F1EE">Continue</a></body></html>`);
}
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
  "/fees /fees.html 200",
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
  `  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://js.stripe.com ${TAG_SCRIPT}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://*.supabase.co ${TAG_IMG}; media-src 'self' blob: https://*.supabase.co; connect-src 'self' ${pub.supabaseUrl || "https://*.supabase.co"} https://api.stripe.com ${TAG_CONNECT}; frame-src https://challenges.cloudflare.com https://js.stripe.com https://*.stripe.com; base-uri 'none'; form-action 'self'`,
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
// Event markup in the built page. T.O.F.T.U. stays out through Jan 9, 2027 Chicago time, and its
// /underground/ file is still the original tickets page written above.
const TOFTU_SCHEMA_AFTER = Date.parse("2027-01-10T00:00:00-06:00");
function eventSchemaTag(s) {
  if (!s || !s.schema) return "";
  const held = Date.now() < TOFTU_SCHEMA_AFTER && (s.slug === "underground" || s.id === "63b511f3-d838-404f-9c2e-5d4b98fbf013");
  if (held) return "";
  const json = JSON.stringify(s.schema).replace(/</g, "\\u003c");
  return `\n<script type="application/ld+json" id="event-schema">${json}</script>`;
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
      (s.share_url ? `\n<meta property="og:image" content="${esc(s.share_url)}">\n<meta name="twitter:card" content="summary_large_image">` : "") +
      eventSchemaTag(s);
    mkdirSync(join(out, s.slug), { recursive: true });
    writeFileSync(join(out, s.slug, "index.html"), base.replace('<meta property="og:type" content="website">', '<meta property="og:type" content="website">\n' + tags));
    n++;
  }
  console.log(`built ${n} show page(s)`);
}
// Artist and flyer/poster short links (subduction.art/go/<tag>) get a tiny real page that hands off to the tap counter, which
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
    // Crawlers stop at this page and never reach the function, so copy the function's own preview tags
    // (real show title, description, image, og:url = the go link) into it. Asking with a robot name
    // gets the preview and counts no tap. If it can't be reached the page keeps the generic tags.
    let tags = `<title>Get tickets</title><meta property="og:title" content="Get tickets"><meta property="og:image" content="${pub.siteUrl}/assets/og.jpg">`;
    try {
      const html = await (await fetch(to, { headers: { "user-agent": "Applebot/0.1 (build preview)" }, redirect: "manual", signal: AbortSignal.timeout(15000) })).text();
      const metas = [...html.matchAll(/<meta property="(?:og|twitter):[a-z:_]+" content="[^"<>]*">/g)].map((m) => m[0]);
      const title = /<title>([^<]*)<\/title>/.exec(html);
      if (title && metas.some((m) => m.includes('property="og:title"')) && metas.some((m) => m.includes(`property="og:url" content="${pub.siteUrl}/go/${r}"`)))
        tags = `<title>${title[1]}</title>\n${metas.join("\n")}`;
      else console.warn(`build: no preview from the function for /go/${r}, using generic tags`);
    } catch (e) { console.warn(`build: preview for /go/${r} unavailable, using generic tags:`, e.message); }
    mkdirSync(join(out, "go", r), { recursive: true });
    writeFileSync(join(out, "go", r, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">${tags}
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
      .replace("<!--CONFIG-->", `<script>window.__QR=${JSON.stringify(t.code)};</script>` + inject + PLAYER + trackingSnippet("subduction"));
    mkdirSync(join(out, "t", t.code), { recursive: true });
    writeFileSync(join(out, "t", t.code, "index.html"), html);
    n++;
  }
  console.log("built", n, "track preview pages");
}
await trackPages();
await showPages();
await goPages();
console.log("built dist/ with", Object.keys(cfg).length, "config keys");
