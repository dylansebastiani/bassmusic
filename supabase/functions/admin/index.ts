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
      db.from("track_scans").select("drop_id,outcome").limit(20000),
      db.from("events").select("slug,name,kind,city,starts_at,is_active").order("starts_at", { ascending: false, nullsFirst: false }).limit(50),
    ]);
    const per: Record<string, { view: number; unlocked: number; already: number }> = {};
    for (const s of scans ?? []) { const p = per[s.drop_id] ??= { view: 0, unlocked: 0, already: 0 }; p[s.outcome as "view" | "unlocked" | "already"]++; }
    const tracks = (drops ?? []).map((d) => ({ ...d, scans: per[d.id] ?? { view: 0, unlocked: 0, already: 0 }, qr_url: d.qr_code ? `${SITE_URL}/t?c=${d.qr_code}` : null }));
    const artists: Record<string, { artist: string; tracks: number; view: number; unlocked: number }> = {};
    for (const t of tracks) { const k = t.artist_slug || "unknown"; const x = artists[k] ??= { artist: t.artist || "Unknown", tracks: 0, view: 0, unlocked: 0 }; x.tracks++; x.view += t.scans.view; x.unlocked += t.scans.unlocked; }
    return ok({ members, with_info: withInfo, tracks, artists: Object.values(artists), events: ev ?? [], brevo_list_id: await setting("brevo_list_id", null) });
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
    return ok({ slug, qr_code: qr, qr_url: `${SITE_URL}/t?c=${qr}` });
  }
  if (a === "qr.svg") {
    const code = (u.searchParams.get("c") || "").toUpperCase(), e = u.searchParams.get("e") || "";
    if (!/^[A-Z0-9]{6,12}$/.test(code)) return no("Bad request");
    const link = `${SITE_URL}/t?c=${code}${e && SLUG.test(e) ? "&e=" + e : ""}`;
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
      description: clean(b.description, 600), ticket_url: /^https?:\/\//.test(clean(b.ticket_url, 300) || "") ? clean(b.ticket_url, 300) : null, prize: clean(b.prize, 120),
      is_active: b.is_active !== false, is_public: b.is_public !== false };
    const { error } = await db.from("events").upsert(row, { onConflict: "slug" });
    if (error) return no("Couldn't save: " + error.message, 500);
    await log("event", { slug, name });
    return ok({ slug, show_url: `${SITE_URL}/?e=${slug}` });
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
