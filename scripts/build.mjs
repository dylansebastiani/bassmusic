// Copies site/ to dist/ and injects config + public env into each page.
// Public env (safe to ship to the browser): SUPABASE_URL, TURNSTILE_SITE_KEY.
// Cloudflare Pages runs `npm run build` with these set in its Environment variables.
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
console.log("built dist/ with", Object.keys(cfg).length, "config keys");
