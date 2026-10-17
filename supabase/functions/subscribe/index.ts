import { db, setting } from "../_shared/db.ts";
import { json, err, preflight, EMAIL_RE, clean, ipHash, clientIp, referralCode, verifyTurnstile } from "../_shared/util.ts";

const SOURCES = new Set(["ig", "tt", "fb", "show", "ref", "dm", "direct"]);

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return err("POST only", 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return err("Bad request"); }

  // Bots fill the hidden field; humans never see it. Pretend it worked.
  if (clean(b.hp, 200)) return json({ access_token: crypto.randomUUID(), already_member: false, event: null });

  const email = (clean(b.email, 254) || "").toLowerCase();
  if (!EMAIL_RE.test(email)) return err("That email doesn't look right.");

  const ip = await ipHash(req, await setting("ip_salt", "unset"));
  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: ip });
  if ((n ?? 0) > 10) return err("Too many signups from this connection. Try again in a minute.", 429);
  if (!(await verifyTurnstile(clean(b.turnstile, 4000), clientIp(req)))) return err("Bot check failed. Refresh and try again.", 403);

  // Attribution
  let source = clean(b.src, 20)?.toLowerCase() || null;
  const refCode = clean(b.r, 12)?.toUpperCase() || null;
  const eventSlug = clean(b.e, 80);
  if (refCode && !source) source = "ref";
  if (eventSlug && !source) source = "show";
  if (source && !SOURCES.has(source)) source = "direct";

  let event: { id: string; slug: string; name: string; prize: string | null } | null = null;
  if (eventSlug) {
    const { data } = await db.from("events").select("id,slug,name,prize").eq("slug", eventSlug).eq("is_active", true).maybeSingle();
    event = data;
  }

  const { data: existing } = await db.from("subscribers").select("id,access_token,status").eq("email", email).maybeSingle();
  let sub = existing;
  let already = false;

  if (sub) {
    already = true;
    // Someone who unsubscribed and signs up again clearly wants back in.
    if (sub.status === "unsubscribed" || sub.status === "sunset") await db.from("subscribers").update({ status: "active" }).eq("id", sub.id);
  } else {
    // Referrer: must exist, must not be the same email (checked by uniqueness) or same device within 24h.
    let referredBy: string | null = null;
    if (refCode) {
      const { data: r } = await db.from("subscribers").select("id,ip_hash,created_at").eq("referral_code", refCode).maybeSingle();
      const recentSameIp = r && r.ip_hash === ip && Date.now() - new Date(r.created_at).getTime() < 86400000;
      if (r && !recentSameIp) referredBy = r.id;
    }
    let code = referralCode();
    for (let i = 0; i < 5; i++) {
      const { data: clash } = await db.from("subscribers").select("id").eq("referral_code", code).maybeSingle();
      if (!clash) break; code = referralCode();
    }
    const ins = await db.from("subscribers").insert({
      email, source, event_id: event?.id ?? null, referred_by: referredBy, referral_code: code,
      utm_source: clean(b.utm_source, 80), utm_medium: clean(b.utm_medium, 80), utm_campaign: clean(b.utm_campaign, 80),
      variant: clean(b.variant, 1), ip_hash: ip, user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
    }).select("id,access_token,status").single();
    if (ins.error) {
      // Lost a race with a duplicate submit of the same email: treat as existing.
      const { data: again } = await db.from("subscribers").select("id,access_token,status").eq("email", email).maybeSingle();
      if (!again) return err("Couldn't save that. Try again.", 500);
      sub = again; already = true;
    } else {
      sub = ins.data;
      await db.from("email_queue").insert({ subscriber_id: sub.id, template_key: "welcome", priority: 1 });
    }
  }

  if (event && sub) {
    await db.from("giveaway_entries").upsert({ event_id: event.id, subscriber_id: sub.id }, { onConflict: "event_id,subscriber_id", ignoreDuplicates: true });
    await db.from("engagement_events").insert({ subscriber_id: sub.id, type: "event_checkin", ref_id: event.id });
  }
  return json({ access_token: sub!.access_token, already_member: already, event: event ? { slug: event.slug, name: event.name, prize: event.prize } : null });
});
