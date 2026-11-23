// Show playlists: the music bar on a show's page plays that show's own tracks, shuffled.
// A promoter uploads tracks for their show, or leaves it on "Subduction tracks" (the site's own catalogue).
// Self-contained on purpose (no shared imports) so deploying it can never disturb the ticketing functions.
//   GET  ?show=<slug>                          public: this show's tracks with 1-hour stream links ([] = play Subduction tracks)
//   GET  ?a=get&show=<id>                      staff: the saved playlist, for editing
//   POST {a:"upload-url", show, ext}           staff: one-time link to upload one track
//   POST {a:"save", show, mode, tracks}        staff: save the playlist
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
    if (!path || !new RegExp("^" + eventId + "/[0-9a-f]{12}\\.(mp3|wav|m4a)$").test(path)) continue;
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
    const saved = ev && pl?.mode === "upload" ? cleanTracks(pl.tracks, ev.id) : [];
    if (!saved.length) return json({ tracks: [] }, 200, { "Cache-Control": "public, max-age=300" });
    const { data: signed } = await db.storage.from("playlists").createSignedUrls(saved.map((t) => t.path), 3600);
    const url = new Map((signed ?? []).filter((x) => x.path && x.signedUrl).map((x) => [x.path as string, x.signedUrl]));
    const tracks = saved.filter((t) => url.has(t.path)).map((t) => ({ slug: "show:" + t.path, title: t.title, artist: t.artist || ev!.name, audio_url: url.get(t.path), artwork_url: null, downloadable: false }));
    return json({ tracks }, 200, { "Cache-Control": "public, max-age=300" });
  }

  // ---- staff: a promoter editing their own show's playlist ----
  const st = await staff(req);
  if (!st) return json({ error: "Sign in again." }, 401);
  const id = String(req.method === "GET" ? u.searchParams.get("show") || "" : b.show || "");
  if (!UUID_RE.test(id)) return json({ error: "Which show?" }, 400);
  const { data: ev } = await db.from("events").select("id,company_id,playlist").eq("id", id).maybeSingle();
  if (!ev || !(st.owner || (ev.company_id && st.companies.includes(ev.company_id)))) return json({ error: "Not your show." }, 403);
  const pl = (ev.playlist ?? {}) as { mode?: string; tracks?: Track[] };

  if (a === "get") return json({ mode: pl.mode === "upload" ? "upload" : "subduction", tracks: cleanTracks(pl.tracks, ev.id), max: MAX_TRACKS }, 200, { "Cache-Control": "no-store" });

  if (a === "upload-url") {
    const ext = String(b.ext || "").toLowerCase();
    if (!EXT[ext]) return json({ error: "Upload an MP3, WAV or M4A." }, 400);
    const path = ev.id + "/" + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((x) => x.toString(16).padStart(2, "0")).join("") + "." + ext;
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
