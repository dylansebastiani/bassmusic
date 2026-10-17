// Fast sanity checks run before every push. Build, then make sure every page
// parses, carries its config, stays under the festival weight budget and never
// leaks a server-side secret into the browser bundle.
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const root = new URL("..", import.meta.url).pathname;
execSync("node scripts/build.mjs", { cwd: root, stdio: "inherit", env: { ...process.env, SUPABASE_URL: process.env.SUPABASE_URL || "https://example.supabase.co" } });
const dist = join(root, "dist");
let bad = 0;
const fail = (m) => { console.error("FAIL", m); bad++; };

for (const f of readdirSync(dist).filter((x) => x.endsWith(".html"))) {
  const html = readFileSync(join(dist, f), "utf8");
  const kb = statSync(join(dist, f)).size / 1024;
  if (kb > 150) fail(`${f} is ${kb.toFixed(0)}KB (limit 150KB)`);
  if (html.includes("<!--CONFIG-->")) fail(`${f}: config was not injected`);
  if (/service_role|SERVICE_ROLE|BREVO_API_KEY|TURNSTILE_SECRET|IP_SALT/.test(html)) fail(`${f}: server secret name appears in page`);
  for (const m of html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)) {
    try { new vm.Script(m[1]); } catch (e) { fail(`${f}: script does not parse: ${e.message}`); }
  }
  if (!/<label[\s>]/.test(html) && /<input/.test(html)) fail(`${f}: inputs without <label>`);
}
// The functions must never ship a secret literal either.
for (const dir of readdirSync(join(root, "supabase/functions"))) {
  const p = join(root, "supabase/functions", dir);
  if (!statSync(p).isDirectory()) continue;
  for (const f of readdirSync(p).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(p, f), "utf8");
    if (/xkeysib-[a-z0-9]{10,}/i.test(src)) fail(`${dir}/${f}: looks like a Brevo key is hard-coded`);
    if (/eyJ[A-Za-z0-9_-]{30,}\./.test(src)) fail(`${dir}/${f}: looks like a JWT is hard-coded`);
  }
}
if (bad) { console.error(`${bad} problem(s)`); process.exit(1); }
console.log("check passed");
