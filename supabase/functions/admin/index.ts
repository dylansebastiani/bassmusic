import QRCode from "npm:qrcode@1.5.4";
import { db, setting } from "../_shared/db.ts";
import { json, err, preflight, EMAIL_RE, clean, ipHash } from "../_shared/util.ts";
import { SITE_URL } from "../_shared/config.ts";
import { sendSignin, MEMBER_COLS, codeHash, type SigninMember } from "../_shared/signin.ts";
import { isAdminEmail, newSession, requireAdmin } from "../_shared/admin.ts";
import { brevoLists, brevoSyncAll } from "../_shared/crm.ts";

// The admin page's one back end. ?a= picks the action. Everything past login needs the
// x-admin-token header, and every write is logged with who did it.
const SLUG = /^[a-z0-9-]{1,80}$/;
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newQr = () => Array.from(crypto.getRandomValues(new Uint8Array(8))).map((x) => ALPHA[x % ALPHA.length]).join("");
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const CORS_ADMIN = { "Access-Control-Allow-Headers": "content-type, x-admin-token" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") { const r = preflight(req)!; return new Response(null, { status: 204, headers: { ...Object.fromEntries(r.headers), ...CORS_ADMIN } }); }
  const u = new URL(req.url), a = u.searchParams.get("a") || "";
  let b: Record<string, unknown> = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { return err("Bad request"); } }
  const ok = (body: unknown, extra: Record<string, string> = {}) => json(body, 200, { "Cache-Control": "no-store", ...CORS_ADMIN, ...extra });
  const no = (m: string, s = 400) => json({ error: m }, s, CORS_ADMIN);

  // ---- sign in: email -> code (only for allow-listed members), code -> session token ----
  if (a === "login" || a === "verify") {
    const email = (clean(b.email, 254) || "").toLowerCase();
    if (!EMAIL_RE.test(email)) return no("That email doesn't look right.");
    const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, (await setting("ip_salt", "unset")) + "|admin") });
    if ((n ?? 0) > 10) return no("Too many tries. Wait a minute.", 429);
    // Same answer whether or not the email is an admin, so the page can't be used to guess the list.
    if (!(await isAdminEmail(email))) return a === "login" ? ok({ code_sent: true }) : no("That code didn't match.");
    const { data: m } = await db.from("subscribers").select(MEMBER_COLS).eq("email", email).maybeSingle();
    if (!m || m.status === "deleted") return a === "login" ? ok({ code_sent: true, note: "Join on the homepage with this email first." }) : no("That code didn't match.");
    if (a === "login") { await sendSignin(m as SigninMember); return ok({ code_sent: true }); }
    const code = (clean(b.code, 12) || "").replace(/\D/g, "");
    const { data: c } = await db.from("signin_codes").select("id,code_hash,expires_at,attempts").eq("subscriber_id", m.id).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!c || new Date(c.expires_at).getTime() < Date.now() || c.attempts >= 5) return no("That code expired. Send a new one.");
    if (c.code_hash !== await codeHash(m.id, code)) { await db.from("signin_codes").update({ attempts: c.attempts + 1 }).eq("id", c.id); return no("That code didn't match."); }
    await db.from("signin_codes").update({ used_at: new Date().toISOString() }).eq("id", c.id);
    return ok({ token: await newSession(m.id), email });
  }

  const admin = await requireAdmin(req);
  if (!admin) return no("Sign in again.", 401);
  const log = (type: string, meta: Record<string, unknown>) => db.from("engagement_events").insert({ subscriber_id: admin.id, type: "admin:" + type, meta });

  // ---- overview: counts, scans per track and per artist ----
  if (a === "overview") {
    const [{ count: members }, { count: withInfo }, { data: drops }, { data: scans }, { data: ev }] = await Promise.all([
      db.from("subscribers").select("id", { count: "exact", head: true }).eq("status", "active"),
      db.from("subscribers").select("id", { count: "exact", head: true }).eq("status", "active").not("first_name", "is", null).not("phone", "is", null).not("zip", "is", null),
      db.from("drops").select("id,slug,title,artist,artist_slug,qr_code,qr_active,is_current,created_at").order("created_at", { ascending: false }),
      db.from("track_scans").select("drop_id,event_id,outcome").limit(20000),
      db.from("events").select("id,slug,name,kind,venue,city,address,starts_at,ends_at,ticket_url,description,is_active,is_public,stickers").order("starts_at", { ascending: false, nullsFirst: false }).limit(50),
    ]);
    // Per show: sticker views and unlocks, plus people who joined at that show.
    const { data: joined } = await db.from("subscribers").select("event_id").not("event_id", "is", null).neq("status", "deleted").limit(20000);
    const byEvent: Record<string, { view: number; unlocked: number; joined: number }> = {};
    for (const s of scans ?? []) { if (!s.event_id) continue; const x = byEvent[s.event_id] ??= { view: 0, unlocked: 0, joined: 0 }; if (s.outcome === "view") x.view++; if (s.outcome === "unlocked") x.unlocked++; }
    for (const j of joined ?? []) { const x = byEvent[j.event_id as string] ??= { view: 0, unlocked: 0, joined: 0 }; x.joined++; }
    const eventsOut = (ev ?? []).map((e) => ({ ...e, scans: byEvent[e.id] ?? { view: 0, unlocked: 0, joined: 0 } }));
    const per: Record<string, { view: number; unlocked: number; already: number }> = {};
    for (const s of scans ?? []) { const p = per[s.drop_id] ??= { view: 0, unlocked: 0, already: 0 }; p[s.outcome as "view" | "unlocked" | "already"]++; }
    const tracks = (drops ?? []).map((d) => ({ ...d, scans: per[d.id] ?? { view: 0, unlocked: 0, already: 0 }, qr_url: d.qr_code ? `${SITE_URL}/t/${d.qr_code}` : null }));
    const artists: Record<string, { artist: string; tracks: number; view: number; unlocked: number }> = {};
    for (const t of tracks) { const k = t.artist_slug || "unknown"; const x = artists[k] ??= { artist: t.artist || "Unknown", tracks: 0, view: 0, unlocked: 0 }; x.tracks++; x.view += t.scans.view; x.unlocked += t.scans.unlocked; }
    return ok({ members, with_info: withInfo, tracks, artists: Object.values(artists), events: eventsOut, brevo_list_id: await setting("brevo_list_id", null) });
  }

  // ---- members: the list, and a CSV of it ----
  if (a === "members" || a === "members.csv") {
    const { data } = await db.from("subscribers")
      .select("email,first_name,phone,zip,source,sms_consent,email_confirmed_at,status,created_at,collection_items(count)")
      .neq("status", "deleted").order("created_at", { ascending: false }).limit(5000);
    const rows = (data ?? []).map((m) => ({ email: m.email, first_name: m.first_name, phone: m.phone, zip: m.zip, source: m.source, sms_consent: m.sms_consent,
      confirmed: !!m.email_confirmed_at, status: m.status, joined: m.created_at, tracks: (m.collection_items as unknown as Array<{ count: number }>)?.[0]?.count ?? 0 }));
    if (a === "members") return ok({ members: rows });
    const cols = ["email", "first_name", "phone", "zip", "source", "sms_consent", "confirmed", "status", "joined", "tracks"] as const;
    const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    await log("export", { rows: rows.length });
    return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="members-${new Date().toISOString().slice(0, 10)}.csv"`, "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*", ...CORS_ADMIN } });
  }

  // ---- tracks: a signed upload slot, then the row ----
  if (a === "upload-url") {
    const slug = clean(b.slug, 80) || "", kind = clean(b.kind, 10) || "", name = (clean(b.filename, 120) || "file").replace(/[^A-Za-z0-9._-]/g, "_");
    if (!SLUG.test(slug) || !["audio", "wav", "cover"].includes(kind)) return no("Bad request");
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    const path = `${slug}/${kind === "cover" ? "cover" : kind === "wav" ? slug + "-master" : slug}${ext}`;
    const { data, error } = await db.storage.from("drops").createSignedUploadUrl(path, { upsert: true });
    if (error || !data) return no("Couldn't start the upload: " + (error?.message || ""), 500);
    return ok({ path, url: data.signedUrl, token: data.token });
  }
  if (a === "track") {
    const title = clean(b.title, 120), artist = clean(b.artist, 120);
    if (!title) return no("Add a title.");
    const slug = SLUG.test(clean(b.slug, 80) || "") ? clean(b.slug, 80)! : slugify(`${artist || ""} ${title}`);
    if (!slug) return no("Add a title.");
    const audio = clean(b.audio_path, 200); if (!audio) return no("Upload the audio file first.");
    const { data: old } = await db.from("drops").select("id,qr_code").eq("slug", slug).maybeSingle();
    let qr = old?.qr_code || newQr();
    for (let i = 0; i < 5 && !old?.qr_code; i++) { const { data: clash } = await db.from("drops").select("id").eq("qr_code", qr).maybeSingle(); if (!clash) break; qr = newQr(); }
    const row = { slug, title, artist, artist_slug: artist ? slugify(artist) : null, description: clean(b.description, 500),
      audio_path: audio, artwork_path: clean(b.artwork_path, 200), download_path: clean(b.download_path, 200), qr_code: qr, qr_active: b.qr_active !== false,
      ...(b.is_current === true ? { is_current: true } : {}) };
    if (b.is_current === true) await db.from("drops").update({ is_current: false }).eq("is_current", true);
    const { error } = await db.from("drops").upsert(row, { onConflict: "slug" });
    if (error) return no("Couldn't save: " + error.message, 500);
    await log("track", { slug, title });
    return ok({ slug, qr_code: qr, qr_url: `${SITE_URL}/t/${qr}` });
  }
  // Edit what's on a track card, or switch its QR off (a misprinted sticker batch dies here).
  if (a === "track-update") {
    const slug = clean(b.slug, 80) || ""; if (!SLUG.test(slug)) return no("Bad request");
    const patch: Record<string, unknown> = {};
    if (typeof b.title === "string" && clean(b.title, 120)) patch.title = clean(b.title, 120);
    if (typeof b.artist === "string") { patch.artist = clean(b.artist, 120); patch.artist_slug = patch.artist ? slugify(patch.artist as string) : null; }
    if (typeof b.description === "string") patch.description = clean(b.description, 500);
    if (typeof b.qr_active === "boolean") patch.qr_active = b.qr_active;
    if (b.is_current === true) { await db.from("drops").update({ is_current: false }).eq("is_current", true); patch.is_current = true; }
    if (!Object.keys(patch).length) return no("Nothing to change.");
    const { error } = await db.from("drops").update(patch).eq("slug", slug);
    if (error) return no("Couldn't save: " + error.message, 500);
    await log("track_update", { slug, ...patch });
    return ok({ slug });
  }
  // Remove a stray file from a track's folder. Never one a track still points at.
  if (a === "delete-file") {
    const path = clean(b.path, 200) || "";
    if (!/^[a-z0-9-]{1,80}\/[A-Za-z0-9._-]{1,120}$/.test(path)) return no("Bad request");
    const { data: used } = await db.from("drops").select("slug").or(`audio_path.eq.${path},artwork_path.eq.${path},download_path.eq.${path}`).limit(1);
    if (used?.length) return no("A track still uses that file.");
    const { error } = await db.storage.from("drops").remove([path]);
    if (error) return no("Couldn't delete: " + error.message, 500);
    await log("delete_file", { path });
    return ok({ deleted: path });
  }
  if (a === "qr.svg") {
    const code = (u.searchParams.get("c") || "").toUpperCase(), e = u.searchParams.get("e") || "";
    if (!/^[A-Z0-9]{6,12}$/.test(code)) return no("Bad request");
    const link = `${SITE_URL}/t/${code}${e && SLUG.test(e) ? "?e=" + e : ""}`;
    const svg = await QRCode.toString(link, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*", ...CORS_ADMIN } });
  }

  // ---- events ----
  if (a === "event") {
    const name = clean(b.name, 120); if (!name) return no("Add a name.");
    const slug = SLUG.test(clean(b.slug, 80) || "") ? clean(b.slug, 80)! : slugify(name);
    const kind = ["show", "popup", "drop", "other"].includes(String(b.kind)) ? String(b.kind) : "show";
    const when = (v: unknown) => { const s = clean(v, 40); return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null; };
    const row = { slug, name, kind, venue: clean(b.venue, 120), city: clean(b.city, 80), address: clean(b.address, 200), starts_at: when(b.starts_at), ends_at: when(b.ends_at),
      description: clean(b.description, 600), ticket_url: /^https?:\/\//.test(clean(b.ticket_url, 300) || "") ? clean(b.ticket_url, 300) : null,
      stickers: Math.max(0, Math.min(100000, Number(b.stickers) || 0)),
      is_active: b.is_active !== false, is_public: b.is_public !== false };
    const { error } = await db.from("events").upsert(row, { onConflict: "slug" });
    if (error) return no("Couldn't save: " + error.message, 500);
    await log("event", { slug, name });
    return ok({ slug, show_url: `${SITE_URL}/?e=${slug}` });
  }

  if (a === "event-toggle") {
    const slug = clean(b.slug, 80) || ""; if (!SLUG.test(slug)) return no("Bad request");
    const { error } = await db.from("events").update({ is_active: b.is_active === true }).eq("slug", slug);
    if (error) return no("Couldn't save: " + error.message, 500);
    await log("event_toggle", { slug, is_active: b.is_active === true });
    return ok({ slug, is_active: b.is_active === true });
  }

  // ---- a ticketed show: lineup, set times, flyers ----
  // The lineup is kept in lineup_full (the draft) and copied to lineup (what the public page shows)
  // when it's revealed. Single-night ticket blurbs follow along ("Treegaud b2b Waylo, Badguy Moolah + more").
  const showSlug = () => { const s = clean(b.e, 80) || u.searchParams.get("e") || ""; return SLUG.test(s) ? s : ""; };
  const chiTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(":00", "");
  const soonBlurb = (n: { starts_at: string | null; ends_at: string | null }) =>
    (n.starts_at ? "Doors " + chiTime(n.starts_at) + (n.ends_at ? " – " + chiTime(n.ends_at) : "") + " · " : "") + "lineup coming soon";
  const fullBlurb = (acts: { name: string; tba?: boolean }[]) => {
    const named = acts.filter((x) => !x.tba && !/special guest/i.test(x.name));
    const top = named.slice(0, 2).map((x) => x.name);
    return top.length ? top.join(", ") + (acts.length > top.length ? " + more" : "") : null;
  };
  type Act = { name: string; note?: string; secret?: boolean; tba?: boolean };
  // What the public page gets from the draft: acts marked secret never leave the draft (one
  // "Headliner TBA" line stands in for them, at the top), and set times are dropped while the show
  // hides them. Every write to the public lineup goes through here, so a save can't leak either.
  const publicActs = (acts: Act[], hideTimes: boolean): Act[] => {
    const shown = acts.filter((x) => !x.secret).map((x) => (x.note && !hideTimes ? { name: x.name, note: x.note } : { name: x.name }));
    return acts.some((x) => x.secret) ? [{ name: "Headliner TBA", tba: true }, ...shown] : shown;
  };
  async function loadShow(slug: string) {
    const { data: ev } = await db.from("events").select("id,slug,name,venue,city,starts_at,sales_open,location_secret,address_reveal_at,address,share_url,door_pin_hash,poster_url,hide_set_times").eq("slug", slug).maybeSingle();
    if (!ev) return null;
    const [{ data: nights }, { data: types }] = await Promise.all([
      db.from("ticket_nights").select("id,slug,label,starts_at,ends_at,lineup,lineup_full,flyer_url,sort").eq("event_id", ev.id).order("sort"),
      db.from("ticket_types").select("id,slug,name,night_ids,on_sale,blurb,blurb_full").eq("event_id", ev.id).order("sort"),
    ]);
    return { ev, nights: nights || [], types: types || [] };
  }
  // Single-night ticket types (not the hidden test ticket) carry a lineup blurb.
  const nightTypes = <T extends { slug: string; night_ids: string[] }>(types: T[], nightId: string) =>
    types.filter((t) => t.slug !== "test" && t.night_ids.length === 1 && t.night_ids[0] === nightId);

  if (a === "show") {
    const s = await loadShow(showSlug()); if (!s) return no("Not found", 404);
    const { ev, nights, types } = s;
    const ns = nights.map((n) => ({ id: n.id, slug: n.slug, label: n.label, starts_at: n.starts_at, ends_at: n.ends_at,
      acts: (n.lineup_full ?? n.lineup ?? []) as Act[], public: ((n.lineup || []) as Act[]).length > 0, flyer_url: n.flyer_url }));
    return ok({
      event: { slug: ev.slug, name: ev.name, city: ev.city, starts_at: ev.starts_at, sales_open: ev.sales_open, has_pin: !!ev.door_pin_hash,
        secret: ev.location_secret, reveal_at: ev.address_reveal_at, address_live: !!ev.address, share_url: ev.share_url,
        page_url: `${SITE_URL}/${ev.slug === "underground" ? "underground/" : "tickets.html?e=" + ev.slug}` },
      nights: ns, ticketed: types.length > 0,
      types: types.map((t) => ({ slug: t.slug, name: t.name, on_sale: t.on_sale, night_ids: t.night_ids })),
      lineup_public: ns.some((n) => n.public), hide_set_times: !!ev.hide_set_times, share_default: `${SITE_URL}/assets/toftu/share-toftu-v3.jpg`,
    });
  }

  if (a === "lineup-save") {
    const s = await loadShow(showSlug()); if (!s) return no("Not found", 404);
    const hideTimes = typeof b.hide_set_times === "boolean" ? b.hide_set_times : !!s.ev.hide_set_times;
    if (typeof b.hide_set_times === "boolean") await db.from("events").update({ hide_set_times: hideTimes }).eq("id", s.ev.id);
    const list = Array.isArray(b.nights) ? b.nights as Record<string, unknown>[] : [];
    for (const item of list) {
      const n = s.nights.find((x) => x.id === item.id); if (!n) continue;
      const acts: Act[] = (Array.isArray(item.acts) ? item.acts as Record<string, unknown>[] : []).slice(0, 30)
        .map((x) => ({ name: clean(x.name, 80) || "", note: clean(x.note, 40) || "", secret: x.secret === true })).filter((x) => x.name)
        .map((x) => ({ name: x.name, ...(x.note ? { note: x.note } : {}), ...(x.secret ? { secret: true } : {}) }));
      const isPublic = ((n.lineup || []) as Act[]).length > 0;
      const pubActs = publicActs(acts, hideTimes);
      await db.from("ticket_nights").update(isPublic ? { lineup_full: acts, lineup: pubActs } : { lineup_full: acts }).eq("id", n.id);
      const blurb = fullBlurb(acts), pubBlurb = fullBlurb(pubActs);
      for (const t of nightTypes(s.types, n.id)) {
        await db.from("ticket_types").update(isPublic ? { blurb_full: blurb, blurb: pubBlurb || soonBlurb(n) } : { blurb_full: blurb }).eq("id", t.id);
      }
    }
    await log("lineup_save", { event: s.ev.slug });
    return ok({ saved: true });
  }

  if (a === "lineup-publish") {
    const s = await loadShow(showSlug()); if (!s) return no("Not found", 404);
    const pub = b.public === true;
    for (const n of s.nights) {
      const acts = publicActs((n.lineup_full ?? []) as Act[], !!s.ev.hide_set_times);
      await db.from("ticket_nights").update({ lineup: pub ? acts : [] }).eq("id", n.id);
      for (const t of nightTypes(s.types, n.id)) {
        await db.from("ticket_types").update({ blurb: pub ? (fullBlurb(acts) || soonBlurb(n)) : soonBlurb(n) }).eq("id", t.id);
      }
    }
    await log(pub ? "lineup_reveal" : "lineup_hide", { event: s.ev.slug });
    return ok({ public: pub });
  }

  // Flyers and the share image: a signed slot in the public media bucket, then save its link.
  if (a === "media-url") {
    const s = await loadShow(showSlug()); if (!s) return no("Not found", 404);
    const kind = b.kind === "share" ? "share" : b.kind === "flyer" ? "flyer" : "";
    const n = kind === "flyer" ? s.nights.find((x) => x.id === b.night) : null;
    if (!kind || (kind === "flyer" && !n)) return no("Bad request");
    const path = `${s.ev.slug}/${kind === "share" ? "share" : "flyer-" + n!.slug}-${Date.now()}.jpg`;
    const { data, error } = await db.storage.from("media").createSignedUploadUrl(path);
    if (error || !data) return no("Couldn't start the upload: " + (error?.message || ""), 500);
    return ok({ path, url: data.signedUrl });
  }
  if (a === "media-save") {
    const s = await loadShow(showSlug()); if (!s) return no("Not found", 404);
    const path = clean(b.path, 200);
    if (path && !new RegExp(`^${s.ev.slug}/[a-z0-9-]+\\.jpg$`).test(path)) return no("Bad request");
    const url = path ? db.storage.from("media").getPublicUrl(path).data.publicUrl : null;
    if (b.kind === "share") {
      // Link previews read one fixed address (<slug>/share.jpg), so copy the new image there.
      // Clearing it puts the built-in image back.
      let bytes: Uint8Array | null = null;
      if (path) { const { data: f } = await db.storage.from("media").download(path); if (f) bytes = new Uint8Array(await f.arrayBuffer()); }
      else { const r = await fetch(`${SITE_URL}/assets/toftu/share-toftu-v3.jpg`).catch(() => null); if (r?.ok) bytes = new Uint8Array(await r.arrayBuffer()); }
      if (bytes) await db.storage.from("media").upload(`${s.ev.slug}/share.jpg`, bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "300" });
      await db.from("events").update({ share_url: url }).eq("id", s.ev.id);
    }
    else if (b.kind === "flyer") {
      const n = s.nights.find((x) => x.id === b.night); if (!n) return no("Bad request");
      await db.from("ticket_nights").update({ flyer_url: url }).eq("id", n.id);
    } else return no("Bad request");
    await log("media", { event: s.ev.slug, kind: b.kind, night: b.night || null, removed: !url });
    return ok({ url });
  }

  // Pull a track file in from a Google Drive or Dropbox share link (or any direct https file link).
  if (a === "import-link") {
    const slug = clean(b.slug, 80) || "", kind = clean(b.kind, 10) || "";
    if (!SLUG.test(slug) || !["audio", "wav", "cover"].includes(kind)) return no("Bad request");
    let src: URL; try { src = new URL(clean(b.url, 800) || ""); } catch { return no("That link doesn't look right."); }
    const host = src.hostname.toLowerCase().replace(/^www\./, "");
    if (src.protocol !== "https:" || /^[\d.]+$/.test(host) || host.includes(":") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return no("Use an https share link.");
    if (host === "soundcloud.com" || host.endsWith(".soundcloud.com") || host === "snd.sc") return no("SoundCloud doesn't let other sites download tracks. Upload the file, or share it from Google Drive or Dropbox.");
    let dl = src.toString();
    if (host === "drive.google.com" || host === "docs.google.com") {
      const id = src.pathname.match(/\/d\/([\w-]{10,})/)?.[1] || src.searchParams.get("id");
      if (!id) return no("That Google Drive link is missing the file. Use Share → Copy link on the file itself.");
      dl = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
    } else if (host === "dropbox.com" || host.endsWith(".dropbox.com")) {
      src.searchParams.delete("dl"); src.searchParams.set("raw", "1"); dl = src.toString();
    }
    const max = kind === "cover" ? 3 : kind === "wav" ? 50 : 20;
    let r: Response;
    try { r = await fetch(dl, { redirect: "follow", signal: AbortSignal.timeout(100_000) }); } catch { return no("Couldn't reach that link. Try again, or upload the file."); }
    if (!r.ok) return no(`Couldn't get the file (error ${r.status}). Set sharing to "Anyone with the link" and try again.`);
    if ((r.headers.get("content-type") || "").includes("text/html")) return no(`That link opens a web page, not the file. Set sharing to "Anyone with the link". Google Drive files over 100 MB can't be pulled in.`);
    if (Number(r.headers.get("content-length") || 0) > max * 1048576) return no(`That file is over ${max} MB.`);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength > max * 1048576) return no(`That file is over ${max} MB.`);
    const at = (i: number, s: string) => [...s].every((ch, k) => buf[i + k] === ch.charCodeAt(0));
    const isWav = at(0, "RIFF") && at(8, "WAVE"), isMp3 = at(0, "ID3") || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0), isM4a = at(4, "ftyp");
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8, isPng = at(1, "PNG");
    let ext = "", type = "";
    if (kind === "audio") {
      if (isWav) return no("That's a WAV. Put it in the WAV download slot, and use an mp3 or m4a for streaming.");
      if (isMp3) { ext = ".mp3"; type = "audio/mpeg"; } else if (isM4a) { ext = ".m4a"; type = "audio/mp4"; } else return no("The streaming file needs to be an mp3 or m4a.");
    } else if (kind === "wav") {
      if (!isWav) return no("That isn't a WAV file."); ext = ".wav"; type = "audio/wav";
    } else {
      if (isJpg) { ext = ".jpg"; type = "image/jpeg"; } else if (isPng) { ext = ".png"; type = "image/png"; } else return no("The cover needs to be a JPG or PNG.");
    }
    const path = `${slug}/${kind === "cover" ? "cover" : kind === "wav" ? slug + "-master" : slug}${ext}`;
    const { error } = await db.storage.from("drops").upload(path, buf, { contentType: type, upsert: true });
    if (error) return no("Couldn't save the file: " + error.message, 500);
    await log("import_link", { slug, kind, host, bytes: buf.byteLength });
    return ok({ path, bytes: buf.byteLength });
  }

  // ---- Brevo ----
  if (a === "brevo-lists") return ok({ lists: await brevoLists(), list_id: await setting("brevo_list_id", null) });
  if (a === "brevo-list") {
    const id = Number(b.list_id); if (!Number.isInteger(id) || id <= 0) return no("Pick a list.");
    await db.from("settings").upsert({ key: "brevo_list_id", value: id, updated_at: new Date().toISOString() });
    return ok({ list_id: id });
  }
  if (a === "brevo-sync") { const r = await brevoSyncAll(); await log("brevo_sync", r); return ok(r); }

  // ---- admins ----
  if (a === "admins") return ok({ emails: await setting<string[]>("admin_emails", []) });
  if (a === "admin-add" || a === "admin-remove") {
    const email = (clean(b.email, 254) || "").toLowerCase(); if (!EMAIL_RE.test(email)) return no("That email doesn't look right.");
    let list = (await setting<string[]>("admin_emails", [])).map((e) => e.toLowerCase());
    if (a === "admin-add") list = [...new Set([...list, email])];
    else { if (email === admin.email.toLowerCase()) return no("You can't remove yourself."); list = list.filter((e) => e !== email); }
    await db.from("settings").upsert({ key: "admin_emails", value: list, updated_at: new Date().toISOString() });
    await log(a, { email });
    return ok({ emails: list });
  }
  return no("Unknown action", 404);
});
