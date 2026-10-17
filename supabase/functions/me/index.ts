import { db } from "../_shared/db.ts";
import { json, err, preflight, UUID_RE } from "../_shared/util.ts";

// What /in and /bonus need, in one call: member basics plus a 10-minute signed
// URL for the current (or bonus) drop. Never returns email or phone.
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const u = new URL(req.url);
  const t = u.searchParams.get("t") || "";
  if (!UUID_RE.test(t)) return err("Not found", 404);
  const { data: m } = await db.from("subscribers")
    .select("id,first_name,zip,phone,referral_code,confirmed_referrals,email_confirmed_at,event_id,status")
    .eq("access_token", t).maybeSingle();
  if (!m || m.status === "deleted") return err("Not found", 404);

  const bonus = u.searchParams.get("kind") === "bonus";
  if (bonus && !m.email_confirmed_at) return err("Confirm your email first", 403);

  const { data: drop } = await db.from("drops").select("id,title,artist,audio_path,artwork_path")
    .eq(bonus ? "is_bonus" : "is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle();

  let dropOut = null;
  if (drop?.audio_path) {
    const [a, art] = await Promise.all([
      db.storage.from("drops").createSignedUrl(drop.audio_path, 600),
      drop.artwork_path ? db.storage.from("drops").createSignedUrl(drop.artwork_path, 600) : Promise.resolve({ data: null }),
    ]);
    dropOut = { title: drop.title, artist: drop.artist, audio_url: a.data?.signedUrl ?? null, artwork_url: art.data?.signedUrl ?? null };
  }
  let entered = false;
  if (m.event_id) {
    const { data: ge } = await db.from("giveaway_entries").select("id").eq("subscriber_id", m.id).eq("event_id", m.event_id).maybeSingle();
    entered = !!ge;
  }
  return json({
    first_name: m.first_name, referral_code: m.referral_code, confirmed_referrals: m.confirmed_referrals,
    confirmed: !!m.email_confirmed_at, profile_done: !!(m.first_name && (m.zip || m.phone)), event_entered: entered, drop: dropOut,
  }, 200, { "Cache-Control": "no-store" });
});
