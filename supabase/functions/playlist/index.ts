// Show playlists: the music bar on a show's page plays that show's own tracks, shuffled.
// A promoter uploads tracks for their show, or leaves it on "Subduction tracks" (the site's own catalogue).
// Self-contained on purpose (no shared imports) so deploying it can never disturb the ticketing functions.
//   GET  ?show=<slug>                          public: this show's tracks with 1-hour stream links ([] = play Subduction tracks)
//   GET  ?a=get&show=<id>                      staff: the saved playlist, for editing
//   POST {a:"upload-url", show, ext}           staff: one-time link to upload one track
//   POST {a:"save", show, mode, tracks}        staff: save the playlist
//   POST {a:"artist-remove", show, id}         staff: take an artist's track out of rotation
// Artist side (private link artist.html?k=<token>, same token as the artist pass):
//   GET  ?a=artist&k=                          my tracks on this show
//   POST {a:"artist-upload-url", k, ext}       one-time link to upload one track
//   POST {a:"artist-add", k, path, title, free_download}
//   POST {a:"artist-set", k, id, free_download}    turn free download on or off
//   POST {a:"artist-remove", k, id}
// Fans:
//   GET  ?a=dl&id=<track>&t=<member key>       a download link, only for members and only if the artist turned it on
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
const EXT: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };
const MAX_TRACKS = 20;
const ARTIST_MAX = 3;      // tracks one artist can add to one show
const PATH_RE = (eventId: string) => new RegExp("^" + eventId + "/[0-9a-f]{12}\\.(mp3|wav|m4a)$");
const newPath = (eventId: string, ext: string) => eventId + "/" + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((x) => x.toString(16).padStart(2, "0")).join("") + "." + ext;
type Track = { path: string; title: string; artist: string | null };

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
    out.push({ path, title: clean((t as Track).title, 80) || "Untitled", artist: clean((t as Track).artist, 80) });
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
    const { data: ev } = await db.from("events").select("id,name,playlist").eq("slug", slug).maybeSingle();
    const pl = (ev?.playlist ?? null) as { mode?: string; tracks?: Track[] } | null;
    if (!ev) return json({ tracks: [] }, 200, { "Cache-Control": "public, max-age=300" });
    const own = pl?.mode === "upload" ? cleanTracks(pl.tracks, ev.id) : [];
    const { data: fromArtists } = await db.from("playlist_tracks").select("id,path,title,artist,free_download").eq("event_id", ev.id).order("created_at").limit(200);
    const all = [...own.map((t) => ({ ...t, id: null as string | null, free_download: false })), ...(fromArtists ?? [])];
    // mix: the promoter left it on "Subduction tracks", so artists' tracks play alongside the catalogue instead of replacing it.
    const mix = pl?.mode !== "upload";
    if (!all.length) return json({ tracks: [], mix }, 200, { "Cache-Control": "public, max-age=300" });
    const { data: signed } = await db.storage.from("playlists").createSignedUrls(all.map((t) => t.path), 3600);
    const url = new Map((signed ?? []).filter((x) => x.path && x.signedUrl).map((x) => [x.path as string, x.signedUrl]));
    const tracks = all.filter((t) => url.has(t.path)).map((t) => ({ slug: "show:" + t.path, title: t.title, artist: t.artist || ev.name, audio_url: url.get(t.path), artwork_url: null,
      downloadable: !!t.free_download, dl: t.free_download ? t.id : null }));
    return json({ tracks, mix }, 200, { "Cache-Control": "public, max-age=300" });
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
    const { data: inv } = await db.from("artist_invites").select("id,event_id,name,claimed_at,revoked_at").eq("token", k).maybeSingle();
    if (!inv || inv.revoked_at) return json({ error: "This link isn't active anymore. Reach out to the promoter." }, 404);
    if (!inv.claimed_at) return json({ error: "Get your artist pass first." }, 400);
    const mine = async () => {
      const { data } = await db.from("playlist_tracks").select("id,title,free_download").eq("invite_id", inv.id).order("created_at");
      return { tracks: data ?? [], max: ARTIST_MAX };
    };
    if (a === "artist") return json(await mine(), 200, { "Cache-Control": "no-store" });
    if (a === "artist-upload-url") {
      const ext = String(b.ext || "").toLowerCase();
      if (!EXT[ext]) return json({ error: "Upload an MP3, WAV or M4A." }, 400);
      if ((await mine()).tracks.length >= ARTIST_MAX) return json({ error: "You've added the most tracks one artist can. Remove one first." }, 400);
      const path = newPath(inv.event_id, ext);
      const { data, error } = await db.storage.from("playlists").createSignedUploadUrl(path);
      if (error || !data) { console.error("playlist artist-upload-url", error?.message); return json({ error: "Couldn't start the upload. Try again." }, 500); }
      return json({ upload_url: data.signedUrl, content_type: EXT[ext], path });
    }
    if (a === "artist-add") {
      const path = clean(b.path, 200);
      if (!path || !PATH_RE(inv.event_id).test(path)) return json({ error: "That upload didn't finish. Try again." }, 400);
      if ((await mine()).tracks.length >= ARTIST_MAX) return json({ error: "You've added the most tracks one artist can. Remove one first." }, 400);
      const { error } = await db.from("playlist_tracks").insert({ event_id: inv.event_id, invite_id: inv.id, path, title: clean(b.title, 80) || "Untitled", artist: inv.name, free_download: b.free_download === true });
      if (error) { console.error("playlist artist-add", error.message); return json({ error: "Couldn't add that. Try again." }, 500); }
      return json(await mine());
    }
    if (a === "artist-set" || a === "artist-remove") {
      const id = String(b.id || "");
      if (!UUID_RE.test(id)) return json({ error: "Which track?" }, 400);
      const { data: tr } = await db.from("playlist_tracks").select("id,path").eq("id", id).eq("invite_id", inv.id).maybeSingle();
      if (!tr) return json({ error: "That track isn't yours." }, 404);
      if (a === "artist-set") await db.from("playlist_tracks").update({ free_download: b.free_download === true }).eq("id", tr.id);
      else { await db.from("playlist_tracks").delete().eq("id", tr.id); await db.storage.from("playlists").remove([tr.path]); }
      return json(await mine());
    }
    return json({ error: "Unknown action" }, 400);
  }

  // ---- staff: a promoter editing their own show's playlist ----
  const st = await staff(req);
  if (!st) return json({ error: "Sign in again." }, 401);
  const id = String(req.method === "GET" ? u.searchParams.get("show") || "" : b.show || "");
  if (!UUID_RE.test(id)) return json({ error: "Which show?" }, 400);
  const { data: ev } = await db.from("events").select("id,company_id,playlist").eq("id", id).maybeSingle();
  if (!ev || !(st.owner || (ev.company_id && st.companies.includes(ev.company_id)))) return json({ error: "Not your show." }, 403);
  const pl = (ev.playlist ?? {}) as { mode?: string; tracks?: Track[] };

  const artistTracks = async () => (await db.from("playlist_tracks").select("id,title,artist,free_download").eq("event_id", ev.id).order("created_at")).data ?? [];
  if (a === "get") return json({ mode: pl.mode === "upload" ? "upload" : "subduction", tracks: cleanTracks(pl.tracks, ev.id), max: MAX_TRACKS, artist_tracks: await artistTracks() }, 200, { "Cache-Control": "no-store" });
  if (a === "artist-remove") {
    const tid = String(b.id || "");
    if (!UUID_RE.test(tid)) return json({ error: "Which track?" }, 400);
    const { data: tr } = await db.from("playlist_tracks").select("id,path").eq("id", tid).eq("event_id", ev.id).maybeSingle();
    if (tr) { await db.from("playlist_tracks").delete().eq("id", tr.id); await db.storage.from("playlists").remove([tr.path]); }
    return json({ artist_tracks: await artistTracks() });
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
