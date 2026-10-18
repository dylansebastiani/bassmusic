import { db } from "../_shared/db.ts";
import { json, err, preflight, UUID_RE } from "../_shared/util.ts";
import { memberByKey } from "../_shared/collection.ts";

// Everything the member app needs in one call: their tracks (10-minute signed links),
// coupons, and upcoming events. Never returns the email; phone and ZIP come back only to the key holder, for the "Your info" box.
// A track in the collection plays and downloads once first name, phone and ZIP are on
// file: the same wall as the welcome track. Before that the page gets cover and title only.
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const u = new URL(req.url);
  const t = u.searchParams.get("t") || "";
  if (!UUID_RE.test(t)) return err("Not found", 404);
  const m = await memberByKey(t, "first_name,zip,phone,sms_consent,email_confirmed_at,referral_code") as
    (null | { id: string; status: string; full: boolean; first_name: string | null; zip: string | null; phone: string | null; sms_consent: boolean | null; email_confirmed_at: string | null; referral_code: string | null });
  if (!m || m.status === "deleted") return err("Not found", 404);
  // Back in only by clicking their own emailed sign-in link.
  if (m.full && u.searchParams.get("rejoin") === "1" && (m.status === "unsubscribed" || m.status === "sunset")) {
    await db.from("subscribers").update({ status: "active", last_engaged_at: new Date().toISOString() }).eq("id", m.id);
  }
  const profileDone = !!(m.first_name && m.phone && m.zip);
  const now = new Date();

  const [{ data: items }, { data: coupons }, { data: events }, { data: been }] = await Promise.all([
    db.from("collection_items")
      .select("unlocked_at, drop:drops(slug,title,artist,artist_slug,description,audio_path,artwork_path,download_path)")
      .eq("subscriber_id", m.id).order("unlocked_at", { ascending: false }).limit(200),
    db.from("coupons").select("code,title,description,url,min_tracks,starts_at,expires_at,artist_slug,event:events(slug,name)")
      .eq("is_active", true).order("min_tracks", { ascending: true }),
    db.from("events").select("slug,name,kind,venue,city,address,starts_at,ends_at,description,ticket_url,prize")
      .eq("is_active", true).eq("is_public", true).order("starts_at", { ascending: true, nullsFirst: false }).limit(60),
    db.from("giveaway_entries").select("event:events(slug)").eq("subscriber_id", m.id),
  ]);

  type D = { slug: string; title: string; artist: string | null; artist_slug: string | null; description: string | null;
    audio_path: string | null; artwork_path: string | null; download_path: string | null };
  const rows = (items ?? []).map((i) => ({ at: i.unlocked_at as string, d: i.drop as unknown as D | null })).filter((r): r is { at: string; d: D } => !!r.d);

  // Batch the signing: one call for audio, one for covers, one for downloads.
  const sign = async (paths: (string | null)[]) => {
    const want = [...new Set(paths.filter((p): p is string => !!p))];
    const out = new Map<string, string>();
    if (!want.length) return out;
    const { data } = await db.storage.from("drops").createSignedUrls(want, 600);
    (data ?? []).forEach((x) => { if (x.path && x.signedUrl) out.set(x.path, x.signedUrl); });
    return out;
  };
  // Downloads are signed one by one so each file lands as "Artist - Title.wav".
  const signDownloads = async () => {
    const out = new Map<string, string>();
    await Promise.all(rows.filter((r) => r.d.download_path).map(async (r) => {
      const ext = r.d.download_path!.includes(".") ? r.d.download_path!.slice(r.d.download_path!.lastIndexOf(".")) : ".wav";
      const name = `${r.d.artist ? r.d.artist + " - " : ""}${r.d.title}${ext}`.replace(/[\\/:*?"<>|]/g, "");
      const { data } = await db.storage.from("drops").createSignedUrl(r.d.download_path!, 600, { download: name });
      if (data?.signedUrl) out.set(r.d.download_path!, data.signedUrl);
    }));
    return out;
  };
  const none = Promise.resolve(new Map<string, string>());
  const [audio, art, dl] = await Promise.all([
    profileDone ? sign(rows.map((r) => r.d.audio_path)) : none,
    sign(rows.map((r) => r.d.artwork_path)),
    profileDone ? signDownloads() : none,
  ]);
  const tracks = rows.map(({ at, d }) => ({
    slug: d.slug, title: d.title, artist: d.artist, artist_slug: d.artist_slug, description: d.description, unlocked_at: at,
    audio_url: d.audio_path ? audio.get(d.audio_path) ?? null : null,
    artwork_url: d.artwork_path ? art.get(d.artwork_path) ?? null : null,
    download_url: d.download_path ? dl.get(d.download_path) ?? null : null,
    locked: !profileDone,
  }));

  // Coupon rules: each one optional, all must hold. Shows they've been to come from scans
  // tagged with a show and from typing their email at the door.
  const have = tracks.length;
  const artists = new Set(tracks.map((k) => k.artist_slug).filter(Boolean));
  const shows = new Set((been ?? []).map((b) => (b.event as unknown as { slug: string } | null)?.slug).filter(Boolean));
  // "You're entered": the show they just scanned (?e=), if they're in its giveaway.
  const eSlug = u.searchParams.get("e");
  let entered: { slug: string; name: string; prize: string | null } | null = null;
  if (eSlug && shows.has(eSlug)) {
    const { data: ev } = await db.from("events").select("slug,name,prize").eq("slug", eSlug).maybeSingle();
    entered = ev;
  }
  const live = (c: { starts_at: string | null; expires_at: string | null }) =>
    (!c.starts_at || new Date(c.starts_at) <= now) && (!c.expires_at || new Date(c.expires_at) >= now);
  const out = (coupons ?? []).filter(live).map((c) => {
    const ev = c.event as unknown as { slug: string; name: string } | null;
    const need: string[] = [];
    if (have < c.min_tracks) need.push(`Collect ${c.min_tracks - have} more track${c.min_tracks - have > 1 ? "s" : ""}`);
    if (ev && !shows.has(ev.slug)) need.push(`Scan at ${ev.name}`);
    if (c.artist_slug && !artists.has(c.artist_slug)) {
      const name = c.artist_slug.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      need.push(`Collect a track by ${name}`);
    }
    const open = !need.length;
    // A locked coupon shows what it takes to open it, never the code.
    return { title: c.title, description: c.description, url: c.url, expires_at: c.expires_at,
      locked: !open, need: need.join(" and "), code: open ? c.code : null };
  });

  // Upcoming and recent: drop anything that ended more than a day ago.
  const cutoff = now.getTime() - 86400000;
  const upcoming = (events ?? []).filter((e) => {
    const end = e.ends_at ?? e.starts_at; return !end || new Date(end).getTime() >= cutoff;
  });

  // The light key (a QR scan with a known email) gets the tracks and the events, nothing personal.
  const personal = m.full
    ? { first_name: m.first_name, phone: m.phone, zip: m.zip, sms_consent: !!m.sms_consent, referral_code: m.referral_code }
    : { first_name: null, phone: null, zip: null, sms_consent: false, referral_code: null };
  return json({
    ...personal, light: !m.full,
    profile_done: profileDone, confirmed: !!m.email_confirmed_at,
    tracks, coupons: out, events: upcoming, entered,
  }, 200, { "Cache-Control": "no-store" });
});
