// Artist waitlist: an artist leaves their artist name, full name, email and phone so we can tell them when artist pages open.
// Self-contained on purpose (no shared imports) so deploying it can never disturb the ticketing functions.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : null) || null;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

async function ipHash(req: Request) {
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0.0.0.0";
  const { data } = await db.from("settings").select("value").eq("key", "ip_salt").maybeSingle();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + String(data?.value ?? "unset")));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  // Bots fill the hidden field; humans never see it. Pretend it worked.
  if (clean(b.hp, 200)) return json({ ok: true });

  const email = (clean(b.email, 254) || "").toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "That email doesn't look right." }, 400);

  const ip = await ipHash(req);
  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: ip });
  if ((n ?? 0) > 20) return json({ error: "Slow down a sec and try again." }, 429);

  // Same email twice just updates the name; the answer is the same either way, so the form never reveals who is on the list.
  const { error } = await db.from("artist_waitlist").upsert({ email, artist_name: clean(b.artist_name, 80), full_name: clean(b.full_name, 80), phone: (clean(b.phone, 30) || "").replace(/[^0-9+()\-. ]/g, "") || null, ip_hash: ip }, { onConflict: "email" });
  if (error) { console.error("artist_waitlist", error.message); return json({ error: "Couldn't save that. Try again." }, 500); }
  return json({ ok: true });
});
