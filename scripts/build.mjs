// Copies site/ to dist/ and injects config + public env into each page.
// Public env (safe to ship to the browser): SUPABASE_URL, TURNSTILE_SITE_KEY.
// The deploy workflow (.github/workflows/pages.yml) runs `npm run build` with these set.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";

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
const rawT = readFileSync(join(out, "t.html"), "utf8");
for (const f of readdirSync(out)) {
  if (!f.endsWith(".html")) continue;
  const p = join(out, f);
  writeFileSync(p, readFileSync(p, "utf8").replace("<!--CONFIG-->", inject));
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
  `/c/:token ${fn}/confirm?t=:token 302`,
  `/u/:token ${fn}/unsubscribe?u=:token 302`,
  "",
].join("\n"));
writeFileSync(join(out, "_headers"), [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  X-Frame-Options: DENY",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
  `  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; media-src 'self' blob: https://*.supabase.co; connect-src 'self' ${pub.supabaseUrl || "https://*.supabase.co"}; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'self'`,
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
        const buf = Buffer.from(await (await fetch(t.artwork_url, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
        writeFileSync(join(out, "assets/drops", `share-${t.code}.jpg`), buf);
        image = `${pub.siteUrl}/assets/drops/share-${t.code}.jpg`; [w, h] = jpegSize(buf) || [0, 0];
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
      .replace("<!--CONFIG-->", `<script>window.__QR=${JSON.stringify(t.code)};</script>` + inject);
    mkdirSync(join(out, "t", t.code), { recursive: true });
    writeFileSync(join(out, "t", t.code, "index.html"), html);
    n++;
  }
  console.log("built", n, "track preview pages");
}
await trackPages();
console.log("built dist/ with", Object.keys(cfg).length, "config keys");
