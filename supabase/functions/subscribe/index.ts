import { db, setting } from "../_shared/db.ts";
import { json, err, preflight, EMAIL_RE, clean, ipHash, clientIp, referralCode, verifyTurnstile } from "../_shared/util.ts";
import { enterEvent } from "../_shared/events.ts";
import { sendSignin, MEMBER_COLS, type SigninMember } from "../_shared/signin.ts";
import { sendNow, welcomeExtra } from "../_shared/sendnow.ts";
import { dropByQr, unlockTrack, type QrDrop } from "../_shared/collection.ts";
import { brevoUpsert } from "../_shared/crm.ts";

const SOURCES = new Set(["ig", "tt", "fb", "show", "ref", "dm", "direct", "qr"]);

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
  // A venue full of phones on one wifi looks like one connection; the bot check and honeypot do the real guarding.
  if ((n ?? 0) > 60) return err("Too many signups from this connection. Try again in a minute.", 429);
  if (!(await verifyTurnstile(clean(b.turnstile, 4000), clientIp(req), clean(b.ts_err, 20)))) return err("Bot check failed. Refresh and try again.", 403);

  // Attribution
  let source = clean(b.src, 20)?.toLowerCase() || null;
  const refCode = clean(b.r, 12)?.toUpperCase() || null;
  const eventSlug = clean(b.e, 80);
  if (refCode && !source) source = "ref";
  if (clean(b.c, 20) && !source) source = "qr";
  if (eventSlug && !source) source = "show";
  if (source && !SOURCES.has(source)) source = "direct";

  let event: { id: string; slug: string; name: string; prize: string | null } | null = null;
  if (eventSlug) {
    const { data } = await db.from("events").select("id,slug,name,prize").eq("slug", eventSlug).maybeSingle();
    event = data;
  }

  // A track's QR code (?c=): the track lands in their collection the moment they're in.
  // Without one, a new member's collection starts with the current welcome track.
  const track = b.c ? await dropByQr(clean(b.c, 20)) : null;
  const welcome = track ? null : (await db.from("drops").select("id,slug,title,artist,artwork_path").eq("is_current", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()).data as QrDrop | null;

  const { data: existing } = await db.from("subscribers").select(MEMBER_COLS).eq("email", email).maybeSingle();
  let sub: SigninMember | null = null;

  if (existing) {
    if (existing.status === "deleted") return err("Couldn't sign you up.", 400);
    return knownMember(existing as SigninMember, event, track, event?.id ?? null);
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
    }).select(MEMBER_COLS).single();
    if (ins.error) {
      // Lost a race with a duplicate submit of the same email: treat as existing.
      const { data: again } = await db.from("subscribers").select(MEMBER_COLS).eq("email", email).maybeSingle();
      if (!again) return err("Couldn't save that. Try again.", 500);
      return knownMember(again as SigninMember, event, track, event?.id ?? null);
    } else {
      sub = ins.data as SigninMember;
      // Welcome goes out now, in the background so signup stays fast. The row waits
      // 15 minutes before the runner would touch it, so it can never send twice.
      const { data: row } = await db.from("email_queue")
        .insert({ subscriber_id: sub.id, template_key: "welcome", priority: 1, send_after: new Date(Date.now() + 15 * 60000).toISOString() })
        .select("id").single();
      // Two days later: a nudge if they still haven't unlocked the track (the runner checks).
      await db.from("email_queue").insert({ subscriber_id: sub.id, template_key: "nudge", priority: 3, send_after: new Date(Date.now() + 2 * 86400000).toISOString() });
      const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
      if (row) {
        const m = sub, job = welcomeExtra().then((extra) => sendNow(m, row.id, "welcome", extra)).catch(() => {});
        rt?.waitUntil(job);
      }
      // Into the CRM too, in the background. Never blocks or breaks the signup.
      rt?.waitUntil(brevoUpsert({ email, first_name: null, phone: null, zip: null, source, sms_consent: false }).catch(() => ({ ok: false })));
    }
  }

  if (event && sub) await enterEvent(sub.id, event.id);
  const first = track ?? welcome;
  if (first && sub) await unlockTrack(sub.id, first.id, event?.id ?? null);
  return json({ access_token: sub!.access_token, already_member: false, event: event ? { slug: event.slug, name: event.name, prize: event.prize } : null, track: first ? { slug: first.slug, title: first.title } : null });
});

// A known email on a phone we don't know. Two cases:
//  - They scanned a track's QR code: the code on the wall is proof enough to put the
//    track in their collection and play it, so this phone gets the LIGHT key right away,
//    no email code. The light key never shows or changes name, phone or ZIP: typing
//    someone else's email at a sticker gets you their tracks, never their details.
//    (Someone who left the list still proves it's them first.)
//  - No QR code: a 6-digit code goes to their inbox and the page swaps to a code box
//    (see verify), so typing an address never hands over the account.
async function knownMember(m: SigninMember, event: { id: string; slug: string; name: string; prize: string | null } | null, track: QrDrop | null, eventId: string | null) {
  if (event) await enterEvent(m.id, event.id);
  const ev = event ? { slug: event.slug, name: event.name, prize: event.prize } : null;
  const tr = track ? { slug: track.slug, title: track.title } : null;
  if (track) {
    await unlockTrack(m.id, track.id, eventId);
    if (m.status === "active") {
      await db.from("engagement_events").insert({ subscriber_id: m.id, type: "signin", meta: { via: "qr" } });
      return json({ access_token: m.light_token, light: true, already_member: true, event: ev, track: tr });
    }
  }
  await sendSignin(m);
  return json({ already_member: true, check_email: true, code_sent: true, event: ev, track: tr });
}
