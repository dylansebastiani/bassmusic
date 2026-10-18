import { db, setting } from "../_shared/db.ts";
import { json, err, preflight, EMAIL_RE, clean, ipHash } from "../_shared/util.ts";
import { codeHash } from "../_shared/signin.ts";

// Email + 6-digit code -> the member's key, so this phone remembers them.
// A code works once, for 10 minutes, and locks after 5 wrong tries; the
// per-connection limit stops anyone cycling through accounts.
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return err("POST only", 405);
  let b: Record<string, unknown>; try { b = await req.json(); } catch { return err("Bad request"); }
  const email = (clean(b.email, 254) || "").toLowerCase(), code = (clean(b.code, 12) || "").replace(/\D/g, "");
  if (!EMAIL_RE.test(email) || code.length !== 6) return err("Enter the 6-digit code from your email.");

  const ip = await ipHash(req, await setting("ip_salt", "unset"));
  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: ip });
  // A venue full of phones can share one connection; each code still locks after 5 wrong tries.
  if ((n ?? 0) > 60) return err("Too many tries. Wait a minute and try again.", 429);

  const { data: m } = await db.from("subscribers").select("id,access_token,status").eq("email", email).maybeSingle();
  if (!m || m.status === "deleted") return err("That code didn't match. Check it, or send a new one.");
  const { data: c } = await db.from("signin_codes").select("id,code_hash,expires_at,attempts")
    .eq("subscriber_id", m.id).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!c || new Date(c.expires_at).getTime() < Date.now()) return err("That code expired. Send a new one.");
  if (c.attempts >= 5) return err("Too many wrong tries. Send a new code.");
  if (c.code_hash !== await codeHash(m.id, code)) {
    await db.from("signin_codes").update({ attempts: c.attempts + 1 }).eq("id", c.id);
    return err("That code didn't match. Check it, or send a new one.");
  }

  const now = new Date().toISOString();
  await db.from("signin_codes").update({ used_at: now }).eq("id", c.id);
  // Typing the code is proof it's them. Someone who unsubscribed and signs back in is back on the list.
  const back = m.status === "unsubscribed" || m.status === "sunset";
  await db.from("subscribers").update({ last_engaged_at: now, ...(back ? { status: "active" } : {}) }).eq("id", m.id);
  await db.from("engagement_events").insert({ subscriber_id: m.id, type: "signin" });
  return json({ access_token: m.access_token });
});
