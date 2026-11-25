// Show playlists: the music bar on a show's page plays that show's own tracks, shuffled.
// A promoter uploads tracks for their show, or leaves it on "Subduction tracks" (the site's own catalogue).
// Self-contained on purpose (no shared imports) so deploying it can never disturb the ticketing functions.
//   GET  ?show=<slug>                          public: this show's tracks with 1-hour stream links ([] = play Subduction tracks)
//   GET  ?a=get&show=<id>                      staff: the saved playlist, for editing
//   POST {a:"upload-url", show, ext}           staff: one-time link to upload one track
//   POST {a:"save", show, mode, tracks}        staff: save the playlist
//   POST {a:"artist-remove", show, id}         staff: take an artist's track out of rotation
//   POST {a:"track-edit", show, id, title, artist, free_download}   staff: fix an artist's track
//   POST {a:"upload-url", show, ext, kind:"art"}                    staff: one-time link to upload a cover
//   POST {a:"track-art", show, id, art_path}   staff: new cover on an artist's track
//   POST {a:"track-file", show, id, path}      staff: replace an artist's track with a new file (path from upload-url)
// Artist side (private link artist.html?k=<token>, same token as the artist pass):
//   GET  ?a=artist&k=                          my tracks on this show
//   POST {a:"artist-upload-url", k, ext}       one-time link to upload one track
//   POST {a:"artist-add", k, path, title, collab?, free_download, art_path}   (a cover is required; collab shows as "Name x Collab")
//   POST {a:"artist-set", k, id, free_download}    turn free download on or off
//   POST {a:"artist-art", k, id, art_path}         put cover art on one of my tracks (art_path from artist-upload-url with ext jpg/png/webp)
//   POST {a:"artist-remove", k, id}
//   POST {a:"artist-rename", k, id, title}         rename one of my tracks
//   POST {a:"artist-upload-url", k, ext, replace:<track id>}   upload link for a new version of one of my tracks
//   POST {a:"artist-file", k, id, path}            swap one of my tracks for the new version
// Fans:
//   GET  ?a=meta&id=<track>                     the track page (/t?d=): title, artist, cover, follow links
//   POST {a:"member-dl", id, t}                 a member unlocks an artist's free track into their collection (same flow as
//                                               every track: email first, then first name / phone / ZIP in the collection). Goes on the artist's fan list.
//   GET  ?a=dl&id=<track>&t=<member key>       (older) a download link for members
// Staff:
//   GET  ?a=downloads&e=<slug>                 everyone who downloaded an artist's track at this show
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-admin-token",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : null) || null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DL_COLS = "name,email,phone,zip,track_title,created_at,subscriber_id";
// Fan list rows show the member's current details (they may add name/phone/ZIP after downloading).
async function fans(rows: Record<string, unknown>[]) {
  const ids = [...new Set(rows.map((r) => r.subscriber_id).filter(Boolean))] as string[];
  const by = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await db.from("subscribers").select("id,email,first_name,phone,zip,status").in("id", ids.slice(i, i + 500));
    for (const m of data ?? []) by.set(m.id as string, m);
  }
  return rows.flatMap(({ subscriber_id, ...r }) => {
    if (!subscriber_id) return [r];
    const m = by.get(subscriber_id as string);
    if (!m || m.status === "deleted") return [];
    return [{ ...r, name: m.first_name || r.name || null, email: m.email || r.email, phone: m.phone || r.phone || null, zip: m.zip || r.zip || null }];
  });
}
const EXT: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };
const ART: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const ART_RE = (eventId: string) => new RegExp("^" + eventId + "/art-[0-9a-f]{12}\\.(jpg|png|webp)$");
// 1-hour links for cover art, keyed by path.
async function signArt(paths: (string | null | undefined)[]) {
  const want = [...new Set(paths.filter((x): x is string => !!x))];
  if (!want.length) return new Map<string, string>();
  const { data } = await db.storage.from("playlists").createSignedUrls(want, 3600);
  return new Map((data ?? []).filter((x) => x.path && x.signedUrl).map((x) => [x.path as string, x.signedUrl]));
}
const MAX_TRACKS = 20;
const ARTIST_MAX = 3;      // tracks one artist can add to one show
const PATH_RE = (eventId: string) => new RegExp("^" + eventId + "/[0-9a-f]{12}\\.(mp3|wav|m4a)$");
const newPath = (eventId: string, ext: string) => eventId + "/" + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((x) => x.toString(16).padStart(2, "0")).join("") + "." + ext;
type Track = { path: string; title: string; artist: string | null; art_path?: string | null };

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Same sign-in as the promoter app: platform staff see every show, a promoter only their own company's.
async function staff(req: Request) {
  const token = (req.headers.get("x-admin-token") || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data: s } = await db.from("admin_sessions").select("subscriber_id,expires_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  const [{ data: m }, { data: st }, { data: rows }] = await Promise.all([
    db.from("subscribers").select("id,email,status").eq("id", s.subscriber_id).maybeSingle(),
    db.from("settings").select("value").eq("key", "admin_emails").maybeSingle(),
    db.from("company_staff").select("company_id").eq("subscriber_id", s.subscriber_id),
  ]);
  if (!m || m.status === "deleted") return null;
  const list = (Array.isArray(st?.value) ? st!.value : []) as string[];
  const owner = list.map((e) => String(e).toLowerCase()).includes(String(m.email).toLowerCase());
  const companies = (rows ?? []).map((r) => r.company_id as string);
  if (!owner && !companies.length) return null;
  return { owner, companies };
}
function cleanTracks(raw: unknown, eventId: string): Track[] {
  const out: Track[] = [];
  for (const t of Array.isArray(raw) ? raw.slice(0, MAX_TRACKS) : []) {
    const path = clean((t as Track)?.path, 200);
    // Only files uploaded for this show, by name pattern: nobody can point a playlist at someone else's audio.
    if (!path || !PATH_RE(eventId).test(path)) continue;
    // A cover only if it was uploaded for this show (same rule as the audio).
    const art = clean((t as Track).art_path, 200);
    out.push({ path, title: clean((t as Track).title, 80) || "Untitled", artist: clean((t as Track).artist, 80), art_path: art && ART_RE(eventId).test(art) ? art : null });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url);
  let b: Record<string, unknown> = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); } }
  const a = req.method === "GET" ? u.searchParams.get("a") || "" : String(b.a || "");

  // ---- public: what the music bar plays on this show's page ----
  if (req.method === "GET" && !a) {
    const slug = (u.searchParams.get("show") || "").toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) return json({ tracks: [] });
    // The show and its artists' tracks in one round trip.
    const { data: ev } = await db.from("events").select("id,name,playlist,pt:playlist_tracks(id,path,title,artist,free_download,art_path,created_at,inv:artist_invites(links,profile_hidden))").eq("slug", slug).maybeSingle();
    const pl = (ev?.playlist ?? null) as { mode?: string; tracks?: Track[] } | null;
    if (!ev) return json({ tracks: [] }, 200, { "Cache-Control": "public, max-age=300" });
    const own = pl?.mode === "upload" ? cleanTracks(pl.tracks, ev.id) : [];
    type AT = { id: string; path: string; title: string; artist: string | null; free_download: boolean; art_path: string | null; created_at: string; inv: unknown };
    const fromArtists = ((ev.pt ?? []) as unknown as AT[]).sort((x, y) => x.created_at.localeCompare(y.created_at)).slice(0, 200).map(({ created_at: _c, ...t }) => t);
    const all = [...own.map((t) => ({ ...t, id: null as string | null, free_download: false, art_path: t.art_path ?? null, inv: null as unknown })), ...fromArtists];
    // mix: the promoter left it on "Subduction tracks", so artists' tracks play alongside the catalogue instead of replacing it.
    const mix = pl?.mode !== "upload";
    if (!all.length) return json({ tracks: [], mix }, 200, { "Cache-Control": "public, max-age=300" });
    // Stream links and covers signed at the same time.
    const [{ data: signed }, art] = await Promise.all([
      db.storage.from("playlists").createSignedUrls(all.map((t) => t.path), 3600),
      signArt(all.map((t) => t.art_path)),
    ]);
    const url = new Map((signed ?? []).filter((x) => x.path && x.signedUrl).map((x) => [x.path as string, x.signedUrl]));
    const tracks = all.filter((t) => url.has(t.path)).map((t) => ({ slug: "show:" + t.path, title: t.title, artist: t.artist || ev.name, audio_url: url.get(t.path), artwork_url: (t.art_path && art.get(t.art_path)) || null,
      downloadable: !!t.free_download, dl: t.free_download ? t.id : null,
      // The artist's own links, for the follow buttons on the download screen (https only, already cleaned when saved).
      links: (() => { const v = t.inv as { links?: Record<string, string>; profile_hidden?: boolean } | null;
        if (!v || v.profile_hidden) return null;
        const out: Record<string, string> = {}; for (const [k, u] of Object.entries(v.links || {})) if (/^https:\/\//.test(String(u))) out[k] = String(u);
        return Object.keys(out).length ? out : null; })() }));
    return json({ tracks, mix }, 200, { "Cache-Control": "public, max-age=300" });
  }

  // ---- the track page for an artist's free download ----
  if (a === "meta" && req.method === "GET") {
    const id = u.searchParams.get("id") || "";
    if (!UUID_RE.test(id)) return json({ error: "Which track?" }, 404);
    const { data: tr } = await db.from("playlist_tracks").select("title,artist,free_download,art_path,inv:artist_invites(links,profile_hidden)").eq("id", id).maybeSingle();
    if (!tr || !tr.free_download) return json({ error: "This track isn't a free download right now." }, 404);
    const art = await signArt([tr.art_path]);
    const v = tr.inv as unknown as { links?: Record<string, string>; profile_hidden?: boolean } | null;
    const links: Record<string, string> = {};
    if (v && !v.profile_hidden) for (const [k, x] of Object.entries(v.links || {})) if (/^https:\/\//.test(String(x))) links[k] = String(x);
    return json({ title: tr.title, artist: tr.artist, artwork_url: (tr.art_path && art.get(tr.art_path)) || null, links }, 200, { "Cache-Control": "public, max-age=60" });
  }

  // ---- a member unlocks an artist's free track into their collection: same rules as every track ----
  if (a === "member-dl" && req.method === "POST") {
    const id = String(b.id || ""), t = String(b.t || "");
    if (!UUID_RE.test(id)) return json({ error: "Which track?" }, 400);
    if (!UUID_RE.test(t)) return json({ error: "Join first." }, 401);
    const { data: m } = await db.from("subscribers").select("id,email,first_name,phone,zip,status").or(`access_token.eq.${t},light_token.eq.${t}`).limit(1).maybeSingle();
    if (!m || m.status === "deleted") return json({ error: "Join first." }, 401);
    const { data: tr } = await db.from("playlist_tracks").select("id,path,title,artist,free_download,invite_id,event_id").eq("id", id).maybeSingle();
    if (!tr || !tr.free_download) return json({ error: "This track isn't a free download right now." }, 404);
    const { data: salt } = await db.from("settings").select("value").eq("key", "ip_salt").maybeSingle();
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0.0.0.0";
    const ipHash = await sha256(ip + "|" + String(salt?.value ?? "unset") + "|dl");
    const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: ipHash });
    if ((n ?? 0) > 30) return json({ error: "Too many tries. Wait a minute and try again." }, 429);
    // One row per fan per track on the artist's list, however many times they download it.
    const { data: had } = await db.from("track_downloads").select("id").eq("track_id", tr.id).eq("subscriber_id", m.id).limit(1).maybeSingle();
    if (!had) {
      await db.from("track_downloads").insert({ track_id: tr.id, invite_id: tr.invite_id, event_id: tr.event_id, track_title: tr.title, subscriber_id: m.id, name: m.first_name, email: m.email, phone: m.phone, zip: m.zip, ip_hash: ipHash });
      await db.from("engagement_events").insert({ subscriber_id: m.id, type: "show_track_download", meta: { track: tr.id } });
    }
    // Into their collection, like every other track. The collection asks for first name / phone / ZIP before it plays or downloads.
    return json({ slug: "show-" + tr.id }, 200, { "Cache-Control": "no-store" });
  }

  // ---- fans: download a track the artist made free. Members only (email first, like every other track). ----
  if (a === "dl") {
    const id = u.searchParams.get("id") || "", t = u.searchParams.get("t") || "";
    if (!UUID_RE.test(id) || !UUID_RE.test(t)) return json({ error: "Join first." }, 401);
    const { data: m } = await db.from("subscribers").select("id,status").or(`access_token.eq.${t},light_token.eq.${t}`).limit(1).maybeSingle();
    if (!m || m.status === "deleted") return json({ error: "Join first." }, 401);
    const { data: tr } = await db.from("playlist_tracks").select("path,title,artist,free_download").eq("id", id).maybeSingle();
    if (!tr || !tr.free_download) return json({ error: "This track isn't a free download." }, 404);
    const name = ((tr.artist ? tr.artist + " - " : "") + tr.title).replace(/[^\w .()&'-]+/g, "").slice(0, 100) + "." + tr.path.split(".").pop();
    const { data: link } = await db.storage.from("playlists").createSignedUrl(tr.path, 600, { download: name });
    if (!link?.signedUrl) return json({ error: "Couldn't get the file. Try again." }, 500);
    await db.from("engagement_events").insert({ subscriber_id: m.id, type: "show_track_download", meta: { track: id } });
    return json({ url: link.signedUrl }, 200, { "Cache-Control": "no-store" });
  }

  // ---- artists: the private link from their artist pass ----
  if (a.startsWith("artist") && (req.method === "GET" ? u.searchParams.has("k") : typeof b.k === "string")) {
    const k = String(req.method === "GET" ? u.searchParams.get("k") : b.k).toLowerCase();
    if (!/^[0-9a-f]{48}$/.test(k)) return json({ error: "This link isn't complete." }, 400);
    let { data: inv } = await db.from("artist_invites").select("id,event_id,name,claimed_at,revoked_at").eq("token", k).maybeSingle();
    if (!inv) {
      // A duo/group member's link: same act, same tracks.
      const { data: m } = await db.from("artist_members").select("invite_id,revoked_at").eq("token", k).maybeSingle();
      if (m && !m.revoked_at) inv = (await db.from("artist_invites").select("id,event_id,name,claimed_at,revoked_at").eq("id", m.invite_id).maybeSingle()).data;
    }
    if (!inv || inv.revoked_at) return json({ error: "This link isn't active anymore. Reach out to the promoter." }, 404);
    if (!inv.claimed_at) return json({ error: "Get your artist pass first." }, 400);
    const mine = async () => {
      const { data } = await db.from("playlist_tracks").select("id,title,free_download,art_path").eq("invite_id", inv.id).order("created_at");
      const art = await signArt((data ?? []).map((t) => t.art_path));
      const { data: dl } = await db.from("track_downloads").select(DL_COLS).eq("invite_id", inv.id).order("created_at", { ascending: false }).limit(5000);
      return { tracks: (data ?? []).map(({ art_path, ...t }) => ({ ...t, art_url: (art_path && art.get(art_path)) || null })), max: ARTIST_MAX, downloads: await fans((dl ?? []) as Record<string, unknown>[]) };
    };
    if (a === "artist") return json(await mine(), 200, { "Cache-Control": "no-store" });
    if (a === "artist-upload-url" && b.kind === "art") {
      const ext = String(b.ext || "").toLowerCase().replace("jpeg", "jpg");
      if (!ART[ext]) return json({ error: "Use a JPG, PNG or WebP for the cover." }, 400);
      const path = inv.event_id + "/art-" + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((x) => x.toString(16).padStart(2, "0")).join("") + "." + ext;
      const { data, error } = await db.storage.from("playlists").createSignedUploadUrl(path);
      if (error || !data) { console.error("playlist artist art upload-url", error?.message); return json({ error: "Couldn't start the upload. Try again." }, 500); }
      return json({ upload_url: data.signedUrl, content_type: ART[ext], path });
    }
    if (a === "artist-upload-url") {
      const ext = String(b.ext || "").toLowerCase();
      if (!EXT[ext]) return json({ error: "Upload an MP3, WAV or M4A." }, 400);
      // A new version of a track they already have doesn't count against the limit.
      const rep = String(b.replace || "");
      const swapping = UUID_RE.test(rep) && !!(await db.from("playlist_tracks").select("id").eq("id", rep).eq("invite_id", inv.id).maybeSingle()).data;
      if (!swapping && (await mine()).tracks.length >= ARTIST_MAX) return json({ error: "You've added the most tracks one artist can. Remove one first." }, 400);
      const path = newPath(inv.event_id, ext);
      const { data, error } = await db.storage.from("playlists").createSignedUploadUrl(path);
      if (error || !data) { console.error("playlist artist-upload-url", error?.message); return json({ error: "Couldn't start the upload. Try again." }, 500); }
      return json({ upload_url: data.signedUrl, content_type: EXT[ext], path });
    }
    if (a === "artist-add") {
      const path = clean(b.path, 200);
      if (!path || !PATH_RE(inv.event_id).test(path)) return json({ error: "That upload didn't finish. Try again." }, 400);
      if ((await mine()).tracks.length >= ARTIST_MAX) return json({ error: "You've added the most tracks one artist can. Remove one first." }, 400);
      const artPath = clean(b.art_path, 200);
      // Every track needs a cover picture (it shows in the music bar while the track plays).
      if (!artPath || !ART_RE(inv.event_id).test(artPath)) return json({ error: "Add a cover picture for this track." }, 400);
      // Their artist name is always on it; a collaborator, if any, goes next to it ("Name x Collab").
      const collab = clean(b.collab, 60);
      const { error } = await db.from("playlist_tracks").insert({ event_id: inv.event_id, invite_id: inv.id, path, title: clean(b.title, 80) || "Untitled", artist: collab ? `${inv.name} x ${collab}`.slice(0, 80) : inv.name, free_download: b.free_download === true,
        art_path: artPath && ART_RE(inv.event_id).test(artPath) ? artPath : null });
      if (error) { console.error("playlist artist-add", error.message); return json({ error: "Couldn't add that. Try again." }, 500); }
      return json(await mine());
    }
    if (a === "artist-set" || a === "artist-remove" || a === "artist-art" || a === "artist-rename" || a === "artist-file") {
      const id = String(b.id || "");
      if (!UUID_RE.test(id)) return json({ error: "Which track?" }, 400);
      const { data: tr } = await db.from("playlist_tracks").select("id,path,art_path").eq("id", id).eq("invite_id", inv.id).maybeSingle();
      if (!tr) return json({ error: "That track isn't yours." }, 404);
      if (a === "artist-art") {
        const artPath = clean(b.art_path, 200);
        if (!artPath || !ART_RE(inv.event_id).test(artPath)) return json({ error: "That cover didn't finish uploading. Try again." }, 400);
        await db.from("playlist_tracks").update({ art_path: artPath }).eq("id", tr.id);
        if (tr.art_path && tr.art_path !== artPath) await db.storage.from("playlists").remove([tr.art_path]);
      } else if (a === "artist-rename") {
        const title = clean(b.title, 80);
        if (!title) return json({ error: "Give it a title." }, 400);
        await db.from("playlist_tracks").update({ title }).eq("id", tr.id);
      } else if (a === "artist-file") {
        const path = clean(b.path, 200);
        if (!path || !PATH_RE(inv.event_id).test(path)) return json({ error: "That upload didn't finish. Try again." }, 400);
        await db.from("playlist_tracks").update({ path }).eq("id", tr.id);
        if (tr.path !== path) await db.storage.from("playlists").remove([tr.path]);
      } else if (a === "artist-set") await db.from("playlist_tracks").update({ free_download: b.free_download === true }).eq("id", tr.id);
      else { await db.from("playlist_tracks").delete().eq("id", tr.id); await db.storage.from("playlists").remove([tr.path, ...(tr.art_path ? [tr.art_path] : [])]); }
      return json(await mine());
    }
    return json({ error: "Unknown action" }, 400);
  }

  // ---- staff: a promoter editing their own show's playlist ----
  const st = await staff(req);
  if (!st) return json({ error: "Sign in again." }, 401);
  if (a === "downloads") {
    const slug = (u.searchParams.get("e") || "").toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) return json({ error: "Which show?" }, 400);
    const { data: sev } = await db.from("events").select("id,company_id").eq("slug", slug).maybeSingle();
    if (!sev || !(st.owner || (sev.company_id && st.companies.includes(sev.company_id)))) return json({ error: "Not your show." }, 403);
    const { data: rows } = await db.from("track_downloads").select("invite_id," + DL_COLS).eq("event_id", sev.id).order("created_at", { ascending: false }).limit(10000);
    return json({ downloads: await fans((rows ?? []) as unknown as Record<string, unknown>[]) }, 200, { "Cache-Control": "no-store" });
  }
  const id = String(req.method === "GET" ? u.searchParams.get("show") || "" : b.show || "");
  if (!UUID_RE.test(id)) return json({ error: "Which show?" }, 400);
  const { data: ev } = await db.from("events").select("id,company_id,playlist").eq("id", id).maybeSingle();
  if (!ev || !(st.owner || (ev.company_id && st.companies.includes(ev.company_id)))) return json({ error: "Not your show." }, 403);
  const pl = (ev.playlist ?? {}) as { mode?: string; tracks?: Track[] };

  const artistTracks = async () => {
    const rows = (await db.from("playlist_tracks").select("id,title,artist,free_download,art_path,path").eq("event_id", ev.id).order("created_at")).data ?? [];
    const art = await signArt(rows.map((t) => t.art_path));
    return rows.map(({ art_path, path, ...t }) => ({ ...t, art_url: (art_path && art.get(art_path)) || null, ext: path.split(".").pop() }));
  };
  // Staff edits to one artist track on this show.
  if (a === "track-edit" || a === "track-art" || a === "track-file") {
    const tid = String(b.id || "");
    if (!UUID_RE.test(tid)) return json({ error: "Which track?" }, 400);
    const { data: tr } = await db.from("playlist_tracks").select("id,path,art_path").eq("id", tid).eq("event_id", ev.id).maybeSingle();
    if (!tr) return json({ error: "That track isn't on this show." }, 404);
    if (a === "track-edit") {
      const { error } = await db.from("playlist_tracks").update({ title: clean(b.title, 80) || "Untitled", artist: clean(b.artist, 80), free_download: b.free_download === true }).eq("id", tr.id);
      if (error) { console.error("playlist track-edit", error.message); return json({ error: "Couldn't save. Try again." }, 500); }
    } else if (a === "track-art") {
      const artPath = clean(b.art_path, 200);
      if (!artPath || !ART_RE(ev.id).test(artPath)) return json({ error: "That cover didn't finish uploading. Try again." }, 400);
      await db.from("playlist_tracks").update({ art_path: artPath }).eq("id", tr.id);
      if (tr.art_path && tr.art_path !== artPath) await db.storage.from("playlists").remove([tr.art_path]);
    } else {
      const path = clean(b.path, 200);
      if (!path || !PATH_RE(ev.id).test(path)) return json({ error: "That upload didn't finish. Try again." }, 400);
      await db.from("playlist_tracks").update({ path }).eq("id", tr.id);
      if (tr.path !== path) await db.storage.from("playlists").remove([tr.path]);
    }
    return json({ artist_tracks: await artistTracks() });
  }
  if (a === "get") {
    // The promoter's own tracks with a 1-hour link to each cover, for the music screen.
    const own = cleanTracks(pl.tracks, ev.id), art = await signArt(own.map((t) => t.art_path));
    return json({ mode: pl.mode === "upload" ? "upload" : "subduction", tracks: own.map((t) => ({ ...t, art_url: (t.art_path && art.get(t.art_path)) || null })),
      max: MAX_TRACKS, artist_tracks: await artistTracks() }, 200, { "Cache-Control": "no-store" });
  }
  if (a === "artist-remove") {
    const tid = String(b.id || "");
    if (!UUID_RE.test(tid)) return json({ error: "Which track?" }, 400);
    const { data: tr } = await db.from("playlist_tracks").select("id,path,art_path").eq("id", tid).eq("event_id", ev.id).maybeSingle();
    if (tr) { await db.from("playlist_tracks").delete().eq("id", tr.id); await db.storage.from("playlists").remove([tr.path, ...(tr.art_path ? [tr.art_path] : [])]); }
    return json({ artist_tracks: await artistTracks() });
  }

  if (a === "upload-url" && b.kind === "art") {
    const ext = String(b.ext || "").toLowerCase().replace("jpeg", "jpg");
    if (!ART[ext]) return json({ error: "Use a JPG, PNG or WebP for the cover." }, 400);
    const path = ev.id + "/art-" + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((x) => x.toString(16).padStart(2, "0")).join("") + "." + ext;
    const { data, error } = await db.storage.from("playlists").createSignedUploadUrl(path);
    if (error || !data) { console.error("playlist art upload-url", error?.message); return json({ error: "Couldn't start the upload. Try again." }, 500); }
    return json({ upload_url: data.signedUrl, content_type: ART[ext], path });
  }
  if (a === "upload-url") {
    const ext = String(b.ext || "").toLowerCase();
    if (!EXT[ext]) return json({ error: "Upload an MP3, WAV or M4A." }, 400);
    const path = newPath(ev.id, ext);
    const { data, error } = await db.storage.from("playlists").createSignedUploadUrl(path);
    if (error || !data) { console.error("playlist upload-url", error?.message); return json({ error: "Couldn't start the upload. Try again." }, 500); }
    return json({ upload_url: data.signedUrl, content_type: EXT[ext], path });
  }

  if (a === "save") {
    const mode = b.mode === "upload" ? "upload" : "subduction";
    const tracks = cleanTracks(b.tracks, ev.id);
    const { error } = await db.from("events").update({ playlist: { mode, tracks } }).eq("id", ev.id);
    if (error) { console.error("playlist save", error.message); return json({ error: "Couldn't save. Try again." }, 500); }
    return json({ mode, tracks });
  }
  return json({ error: "Unknown action" }, 400);
});
