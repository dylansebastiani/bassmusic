import { db } from "../_shared/db.ts";
import { json, err, preflight, UUID_RE } from "../_shared/util.ts";

// Everything the member app needs in one call: their tracks (10-minute signed links),
// coupons, and upcoming events. Never returns email or phone.
// Play works the moment a track is unlocked. The lossless download also needs first
// name, phone and ZIP on file (the same wall as the welcome track), so it stays skippable.
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!UUID_RE.test(t)) return err("Not found", 404);
  const { data: m } = await db.from("subscribers")
    .select("id,first_name,zip,phone,email_confirmed_at,referral_code,status").eq("access_token", t).maybeSingle();
  if (!m || m.status === "deleted") return err("Not found", 404);
  const profileDone = !!(m.first_name && m.phone && m.zip);
  const now = new Date();

  const [{ data: items }, { data: coupons }, { data: events }, { data: welcome }] = await Promise.all([
    db.from("collection_items")
      .select("unlocked_at, drop:drops(slug,title,artist,artist_slug,description,audio_path,artwork_path,download_path)")
      .eq("subscriber_id", m.id).order("unlocked_at", { ascending: false }).limit(200),
    db.from("coupons").select("code,title,description,url,min_tracks,starts_at,expires_at")
      .eq("is_active", true).order("min_tracks", { ascending: true }),
    db.from("events").select("slug,name,kind,venue,city,address,starts_at,ends_at,description,ticket_url,prize")
      .eq("is_active", true).eq("is_public", true).order("starts_at", { ascending: true, nullsFirst: false }).limit(60),
    db.from("drops").select("id").eq("is_current", true).limit(1).maybeSingle(),
  ]);

  type D = { slug: string; title: string; artist: string | null; artist_slug: string | null; description: string | null;
    audio_path: string | null; artwork_path: string | null; download_path: string | null };
  const rows = (items ?? []).map((i) => ({ at: i.unlocked_at as string, d: i.drop as unknown as D | null })).filter((r): r is { at: string; d: D } => !!r.d);

  // Batch the signing: one call for audio, one for covers, one for downloads.
  const sign = async (paths: (string | null)[], opts?: { download: boolean }) => {
    const want = [...new Set(paths.filter((p): p is string => !!p))];
    const out = new Map<string, string>();
    if (!want.length) return out;
    const { data } = await db.storage.from("drops").createSignedUrls(want, 600, opts);
    (data ?? []).forEach((x) => { if (x.path && x.signedUrl) out.set(x.path, x.signedUrl); });
    return out;
  };
  const [audio, art, dl] = await Promise.all([
    sign(rows.map((r) => r.d.audio_path)),
    sign(rows.map((r) => r.d.artwork_path)),
    profileDone ? sign(rows.map((r) => r.d.download_path), { download: true }) : Promise.resolve(new Map<string, string>()),
  ]);
  const tracks = rows.map(({ at, d }) => ({
    slug: d.slug, title: d.title, artist: d.artist, artist_slug: d.artist_slug, description: d.description, unlocked_at: at,
    audio_url: d.audio_path ? audio.get(d.audio_path) ?? null : null,
    artwork_url: d.artwork_path ? art.get(d.artwork_path) ?? null : null,
    download_url: d.download_path ? dl.get(d.download_path) ?? null : null,
    download_locked: !!d.download_path && !profileDone,
  }));

  const have = tracks.length;
  const live = (c: { starts_at: string | null; expires_at: string | null }) =>
    (!c.starts_at || new Date(c.starts_at) <= now) && (!c.expires_at || new Date(c.expires_at) >= now);
  const out = (coupons ?? []).filter(live).map((c) => {
    const open = have >= c.min_tracks;
    // A locked coupon shows what it takes to open it, never the code.
    return { title: c.title, description: c.description, url: c.url, expires_at: c.expires_at,
      locked: !open, need: open ? 0 : c.min_tracks - have, code: open ? c.code : null };
  });

  // Upcoming and recent: drop anything that ended more than a day ago.
  const cutoff = now.getTime() - 86400000;
  const upcoming = (events ?? []).filter((e) => {
    const end = e.ends_at ?? e.starts_at; return !end || new Date(end).getTime() >= cutoff;
  });

  return json({
    first_name: m.first_name, profile_done: profileDone, confirmed: !!m.email_confirmed_at, referral_code: m.referral_code,
    has_welcome: !!welcome, tracks, coupons: out, events: upcoming,
  }, 200, { "Cache-Control": "no-store" });
});
