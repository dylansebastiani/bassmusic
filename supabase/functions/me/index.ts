import { db } from "../_shared/db.ts";
import { json, err, preflight, UUID_RE } from "../_shared/util.ts";

// What /in and /bonus need, in one call: member basics, their shows and unlocks,
// plus a 10-minute signed URL for the current (or bonus) drop. Never returns email or phone.
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const u = new URL(req.url);
  const t = u.searchParams.get("t") || "";
  if (!UUID_RE.test(t)) return err("Not found", 404);
  const { data: m } = await db.from("subscribers")
    .select("id,first_name,zip,phone,referral_code,confirmed_referrals,email_confirmed_at,event_id,status")
    .eq("access_token", t).maybeSingle();
  if (!m || m.status === "deleted") return err("Not found", 404);

  // Back in only by clicking their own emailed sign-in link.
  if (u.searchParams.get("rejoin") === "1" && (m.status === "unsubscribed" || m.status === "sunset")) {
    await db.from("subscribers").update({ status: "active", last_engaged_at: new Date().toISOString() }).eq("id", m.id);
    m.status = "active";
  }

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

  const [{ data: entries }, { data: rewards }] = await Promise.all([
    db.from("giveaway_entries").select("created_at, event:events(slug,name,city,starts_at,prize)")
      .eq("subscriber_id", m.id).order("created_at", { ascending: false }).limit(25),
    db.from("rewards").select("tier,note,granted_at").eq("subscriber_id", m.id).order("granted_at", { ascending: false }),
  ]);
  type Ev = { slug: string; name: string; city: string | null; starts_at: string | null; prize: string | null };
  const shows = (entries ?? []).map((e) => e.event as unknown as Ev | null).filter((e): e is Ev => !!e)
    .map((e) => ({ slug: e.slug, name: e.name, city: e.city, starts_at: e.starts_at, prize: e.prize }));

  // "You're entered" for the show they just scanned, else the one they joined at.
  const e = u.searchParams.get("e");
  let current: Ev | null = null;
  if (e) current = shows.find((s) => s.slug === e) ?? null;
  else if (m.event_id) {
    const { data: ev } = await db.from("events").select("slug").eq("id", m.event_id).maybeSingle();
    current = shows.find((s) => s.slug === ev?.slug) ?? null;
  }

  return json({
    first_name: m.first_name, referral_code: m.referral_code, confirmed_referrals: m.confirmed_referrals,
    confirmed: !!m.email_confirmed_at, profile_done: !!(m.first_name && (m.zip || m.phone)),
    event_entered: !!current, event: current, shows, unlocks: (rewards ?? []).map((r) => ({ tier: r.tier, label: r.note })),
    drop: dropOut,
  }, 200, { "Cache-Control": "no-store" });
});
