import { db, setting } from "../_shared/db.ts";
import { json, preflight, clean, ipHash, EMAIL_RE, sha256 } from "../_shared/util.ts";
import { requireAdmin } from "../_shared/admin.ts";
import { sendTickets } from "../_shared/send.ts";
import { SITE_URL } from "../_shared/config.ts";

// Artist invites.
// Artist side (private link artist.html?k=<token>, no sign-in):
//   GET  ?a=get&k=           what the page shows: the artist, their pass, their guest list
//   POST {a:"claim",k,...}   name + email + phone -> their gold Artist Pass is issued and emailed
//   POST {a:"guest",k,...}   add a guest (name, email, phone, night) -> a real ticket, emailed
//   POST {a:"remove",k,...}  take a guest off (before doors, and only if not scanned in)
//   POST {a:"resend",k}      email their pass again
//   POST {a:"profile",k,...} photo is separate; bio, hometown, genre, links (shown on the lineup), rider (private)
//   POST {a:"photo-url",k,ext} / {a:"photo",k,path}   upload a press photo
// Public:
//   GET  ?a=lineup&e=slug    artists' public profiles for a show's lineup (never the rider, legal name or contact info)
// Staff side (signed in on /admin, x-admin-token):
//   GET  ?a=list&e=slug      every invite for a show with its guests
//   POST {a:"create",e,...}  artist name + guest spots (+ optional real name, email, phone) -> the private link;
//                            with all three contact fields the pass is issued and emailed right away
//   POST {a:"update",id,...} change name, guest spots, or hide/show their public profile
//   POST {a:"revoke",id}     link stops working; their pass and their guests' tickets are cancelled
const TOKEN = /^[0-9a-f]{48}$/, SLUG = /^[a-z0-9-]{1,80}$/;
const CORS_A = { "Access-Control-Allow-Headers": "content-type, x-admin-token" };
const phoneOf = (v: unknown) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 10 ? "+1" + d : d.length === 11 && d[0] === "1" ? "+" + d : d.length >= 11 && d.length <= 15 ? "+" + d : null;
};

// ---- artist profiles ----
const PHOTO_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const photoUrl = (path: string | null) => (path ? db.storage.from("artist-photos").getPublicUrl(path).data.publicUrl : null);
// Links are stored as clean https addresses only, so nothing odd can ever end up behind a button on a public page.
const LINK_HOSTS: Record<string, string[]> = {
  instagram: ["instagram.com"], soundcloud: ["soundcloud.com", "on.soundcloud.com"], spotify: ["open.spotify.com", "spotify.link"],
  tiktok: ["tiktok.com"], youtube: ["youtube.com", "youtu.be"], website: [],
};
function cleanLink(key: string, raw: unknown): string | null {
  let v = (clean(raw, 300) || "").replace(/\s+/g, "");
  if (!v) return null;
  if (key === "instagram" && /^@?[A-Za-z0-9._]{1,30}$/.test(v)) v = "https://instagram.com/" + v.replace(/^@/, "");
  if (key === "tiktok" && /^@?[A-Za-z0-9._]{1,30}$/.test(v)) v = "https://tiktok.com/@" + v.replace(/^@/, "");
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  let u: URL; try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.protocol = "https:";
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const ok = LINK_HOSTS[key];
  if (!ok || (ok.length && !ok.some((h) => host === h || host.endsWith("." + h)))) return null;
  return u.toString().slice(0, 300);
}
function cleanLinks(raw: unknown) {
  const out: Record<string, string> = {};
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const k of Object.keys(LINK_HOSTS)) { const v = cleanLink(k, src[k]); if (v) out[k] = v; }
  return out;
}

// The artist's legal name stays on the order (door list, member record). The ticket itself
// carries their artist name, so the pass, the PDF and the email all say who they are on the bill.
type Inv = { id: string; event_id: string; name: string };
async function issueOrder(inv: Inv, p: { name: string; email: string; phone: string }, t: { id: string; name: string }, tier: string, list: string, own: boolean) {
  const { data: o, error } = await db.from("ticket_orders").insert({
    event_id: inv.event_id, status: "pending", email: p.email, name: p.name, phone: p.phone, comp_list: list, artist_invite_id: inv.id,
    items: [{ type_id: t.id, name: t.name, tier, unit_cents: 0, qty: 1 }],
  }).select("id").single();
  if (error || !o) return null;
  if (own) await db.from("artist_invites").update({ order_id: o.id }).eq("id", inv.id);
  await db.rpc("ticket_issue", { p_order: o.id, p_status: "comp" });
  if (own) await db.from("tickets").update({ holder_name: inv.name }).eq("order_id", o.id);
  return { id: o.id, sent: await sendTickets(o.id) };
}
// Real name (first and last), email and phone, as checkout asks for them.
function contact(b: Record<string, unknown>, key = "name") {
  const name = (clean(b[key], 80) || "").replace(/\s+/g, " ");
  const email = (clean(b.email, 254) || "").toLowerCase();
  const phone = phoneOf(b.phone);
  if (name.split(" ").length < 2) return { err: "Enter the full name (first and last)." };
  if (!EMAIL_RE.test(email)) return { err: "Enter a real email address." };
  if (!phone) return { err: "Enter a phone number we can reach." };
  return { name, email, phone };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") { const r = preflight(req)!; return new Response(null, { status: 204, headers: { ...Object.fromEntries(r.headers), ...CORS_A } }); }
  const u = new URL(req.url);
  if (u.searchParams.get("a") === "ping") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });   // staff page warm-up
  let b: Record<string, unknown> = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { return no("Bad request"); } }
  const a = String(b.a || u.searchParams.get("a") || "");
  function ok(body: unknown) { return json(body, 200, { "Cache-Control": "no-store", ...CORS_A }); }
  function no(m: string, s = 400) { return json({ error: m }, s, CORS_A); }

  // ================= public: artist profiles for a show's lineup =================
  if (a === "lineup" && req.method === "GET") {
    const slug = String(u.searchParams.get("e") || "");
    if (!SLUG.test(slug)) return no("Bad request");
    const { data: ev } = await db.from("events").select("id").eq("slug", slug).maybeSingle();
    if (!ev) return json({ artists: [] }, 200, { "Cache-Control": "public, max-age=300", ...CORS_A });
    const [{ data: rows }, { data: ns }] = await Promise.all([
      db.from("artist_invites").select("name,photo_path,bio,hometown,genre,links")
        .eq("event_id", ev.id).is("revoked_at", null).not("claimed_at", "is", null).eq("profile_hidden", false),
      db.from("ticket_nights").select("lineup,lineup_full").eq("event_id", ev.id),
    ]);
    // A show holding its lineup back (a draft in lineup_full) only gives out the artists already on the
    // published lineup, so this can't leak who's playing before the reveal. Other shows: unchanged.
    const held = (ns || []).some((n) => n.lineup_full != null);
    const shown = (ns || []).flatMap((n) => (Array.isArray(n.lineup) ? n.lineup : []).map((x: { name?: string }) => String(x?.name || ""))).join(" | ").toLowerCase();
    const artists = (rows || []).filter((r) => !held || (r.name && shown.includes(String(r.name).toLowerCase())))
      .filter((r) => r.photo_path || r.bio || r.hometown || r.genre || Object.keys(r.links || {}).length)
      .map((r) => ({ name: r.name, photo_url: photoUrl(r.photo_path), bio: r.bio, hometown: r.hometown, genre: r.genre, links: cleanLinks(r.links) }));
    return json({ artists }, 200, { "Cache-Control": "public, max-age=300", ...CORS_A });
  }

  // ================= the show's crew owner, from their account page =================
  // Same steps as the staff "create" below (name, contact, pass issued and emailed), but signed in as the
  // show's own crew owner. Contact is required here, so the pass always goes out right away.
  if (a === "crew_create" || a === "crew_revoke") {
    const tok = (req.headers.get("x-admin-token") || "").trim();
    if (!/^[0-9a-f]{64}$/.test(tok)) return no("Sign in again.", 401);
    const { data: sess } = await db.from("admin_sessions").select("subscriber_id,expires_at").eq("token_hash", await sha256(tok)).maybeSingle();
    if (!sess || new Date(sess.expires_at).getTime() < Date.now()) return no("Sign in again.", 401);
    const { data: mem } = await db.from("subscribers").select("id,email,status").eq("id", sess.subscriber_id).maybeSingle();
    if (!mem || mem.status === "deleted") return no("Sign in again.", 401);
    const slug = String(b.e || u.searchParams.get("e") || "");
    if (!SLUG.test(slug)) return no("Bad request");
    const { data: ev } = await db.from("events").select("id,slug,company_id").eq("slug", slug).maybeSingle();
    if (!ev) return no("Not found", 404);
    const isStaff = ((await setting<string[]>("admin_emails", [])) || []).map((e) => String(e).toLowerCase()).includes(String(mem.email).toLowerCase());
    let allowed = isStaff;
    if (!allowed && ev.company_id) {
      const { data: row } = await db.from("company_staff").select("role").eq("subscriber_id", mem.id).eq("company_id", ev.company_id).maybeSingle();
      allowed = row?.role === "owner";
    }
    if (!allowed) return no("Only the show's crew owner can add artists.", 403);
    const { data: rl } = await db.rpc("bump_rate_limit", { p_ip_hash: "crewartist|" + mem.id });
    if ((rl ?? 0) > 20) return no("Too many changes at once. Wait a minute.", 429);
    const clog = (type: string, meta: Record<string, unknown>) => db.from("engagement_events").insert({ subscriber_id: mem.id, type: "crew:" + type, meta });

    if (a === "crew_revoke") {
      const id = clean(b.id, 40) || "";
      const { data: inv } = await db.from("artist_invites").select("id,name,created_by,revoked_at").eq("id", id).eq("event_id", ev.id).maybeSingle();
      if (!inv) return no("Not found", 404);
      if (!isStaff && inv.created_by !== mem.id) return no("Only artists you added can be taken off here.");
      if (inv.revoked_at) return ok({ revoked: true });
      await db.from("artist_invites").update({ revoked_at: new Date().toISOString() }).eq("id", id);
      const { data: os } = await db.from("ticket_orders").select("id").eq("artist_invite_id", id);
      if (os?.length) await db.from("tickets").update({ status: "void" }).in("order_id", os.map((o) => o.id));
      await clog("artist_revoke", { event: slug, id, name: inv.name, tickets_cancelled: os?.length || 0 });
      return ok({ revoked: true });
    }

    const name = clean(b.name, 80); if (!name) return no("Add the artist's name (how it shows on the lineup).");
    const p = contact(b, "full_name");
    if ("err" in p) return no(p.err!);
    const { data: dup } = await db.from("artist_invites").select("id").eq("event_id", ev.id).is("revoked_at", null).ilike("name", name).maybeSingle();
    if (dup) return no(name + " is already on this show.");
    const t = (await db.from("ticket_types").select("id,name").eq("event_id", ev.id).eq("slug", "artist").maybeSingle()).data;
    if (!t) return no("Artist passes aren't set up for this show yet.");
    const spots = Math.max(0, Math.min(10, Math.floor(Number(b.spots ?? 2))));
    const { data: inv, error } = await db.from("artist_invites").insert({ event_id: ev.id, name, guest_spots: spots, created_by: mem.id,
      full_name: p.name, email: p.email, phone: p.phone, claimed_at: new Date().toISOString() }).select("id,event_id,name,token").single();
    if (error || !inv) return no("Couldn't save that artist.", 500);
    const r = await issueOrder(inv, p as { name: string; email: string; phone: string }, t, "Artist", "Artist", true);
    await clog("artist_invite", { event: slug, name, spots, pass_sent: r ? r.sent : false });
    return ok({ added: true, pass_sent: r ? !!r.sent : false });
  }

  // ================= staff =================
  if (["list", "create", "update", "revoke"].includes(a)) {
    const admin = await requireAdmin(req);
    if (!admin) return no("Sign in again.", 401);
    const log = (type: string, meta: Record<string, unknown>) => db.from("engagement_events").insert({ subscriber_id: admin.id, type: "admin:" + type, meta });

    if (a === "list" || a === "create") {
      const slug = String(b.e || u.searchParams.get("e") || "");
      if (!SLUG.test(slug)) return no("Bad request");
      const { data: ev } = await db.from("events").select("id,slug").eq("slug", slug).maybeSingle();
      if (!ev) return no("Not found", 404);
      if (a === "create") {
        const name = clean(b.name, 80); if (!name) return no("Add the artist's name.");
        const spots = Math.max(0, Math.min(50, Math.floor(Number(b.spots ?? 2))));
        // Contact info is optional here; if any of it is filled in, all of it has to be right.
        const any = [b.full_name, b.email, b.phone].some((v) => typeof v === "string" && v.trim());
        const p = any ? contact(b, "full_name") : null;
        if (p && "err" in p) return no(p.err + " Or leave all three blank and the artist fills them in from their link.");
        const t = p ? (await db.from("ticket_types").select("id,name").eq("event_id", ev.id).eq("slug", "artist").maybeSingle()).data : null;
        if (p && !t) return no("Artist passes aren't set up for this show yet.");
        const { data: inv, error } = await db.from("artist_invites").insert({ event_id: ev.id, name, guest_spots: spots, created_by: admin.id,
          ...(p && !("err" in p) ? { full_name: p.name, email: p.email, phone: p.phone, claimed_at: new Date().toISOString() } : {}) }).select("id,event_id,name,token").single();
        if (error || !inv) return no("Couldn't save that artist.", 500);
        let sent: boolean | null = null;
        if (p && !("err" in p) && t) { const r = await issueOrder(inv, p, t, "Artist", "Artist", true); sent = r ? r.sent : false; }
        await log("artist_invite", { event: slug, name, spots, pass_sent: sent });
        return ok({ id: inv.id, link: `${SITE_URL}/artist.html?k=${inv.token}`, pass_sent: sent });
      }
      const { data: invs } = await db.from("artist_invites").select("id,name,full_name,token,guest_spots,email,phone,claimed_at,revoked_at,order_id,created_at,photo_path,bio,hometown,genre,links,rider,profile_hidden").eq("event_id", ev.id).order("created_at");
      const ids = (invs || []).map((i) => i.id);
      const { data: orders } = ids.length ? await db.from("ticket_orders").select("id,artist_invite_id,name,email,status").in("artist_invite_id", ids).eq("status", "comp") : { data: [] };
      const { data: tix } = orders?.length ? await db.from("tickets").select("order_id,status,type_id").in("order_id", orders.map((o) => o.id)).eq("status", "valid") : { data: [] };
      const live = new Set((tix || []).map((t) => t.order_id));
      return ok({ artists: (invs || []).map((i) => {
        const guests = (orders || []).filter((o) => o.artist_invite_id === i.id && o.id !== i.order_id && live.has(o.id));
        return { id: i.id, name: i.name, full_name: i.full_name, phone: i.phone, spots: i.guest_spots, email: i.email, claimed: !!i.claimed_at, revoked: !!i.revoked_at,
          link: `${SITE_URL}/artist.html?k=${i.token}`, guests: guests.map((g) => ({ name: g.name, email: g.email })),
          profile: { photo_url: photoUrl(i.photo_path), bio: i.bio, hometown: i.hometown, genre: i.genre, links: cleanLinks(i.links), rider: i.rider, hidden: i.profile_hidden } };
      }) });
    }
    const id = clean(b.id, 40) || "";
    const { data: inv } = await db.from("artist_invites").select("id,event_id,name,order_id").eq("id", id).maybeSingle();
    if (!inv) return no("Not found", 404);
    if (a === "update") {
      const patch: Record<string, unknown> = {};
      if (b.spots !== undefined) patch.guest_spots = Math.max(0, Math.min(50, Math.floor(Number(b.spots))));
      if (typeof b.name === "string" && clean(b.name, 80)) patch.name = clean(b.name, 80);
      if (typeof b.profile_hidden === "boolean") patch.profile_hidden = b.profile_hidden;
      if (!Object.keys(patch).length) return no("Nothing to change.");
      await db.from("artist_invites").update(patch).eq("id", id);
      await log("artist_update", { id, ...patch });
      return ok({ saved: true });
    }
    // revoke: the link dies, and the pass plus every guest ticket from this artist is cancelled
    await db.from("artist_invites").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    const { data: os } = await db.from("ticket_orders").select("id").eq("artist_invite_id", id);
    if (os?.length) await db.from("tickets").update({ status: "void" }).in("order_id", os.map((o) => o.id));
    await log("artist_revoke", { id, name: inv.name, tickets_cancelled: os?.length || 0 });
    return ok({ revoked: true });
  }

  // ================= artist (private link) =================
  const k = String(b.k || u.searchParams.get("k") || "").toLowerCase();
  if (!TOKEN.test(k)) return no("This link isn't valid.", 404);
  const { data: inv } = await db.from("artist_invites").select("id,event_id,name,guest_spots,email,phone,order_id,claimed_at,revoked_at,photo_path,bio,hometown,genre,links,rider").eq("token", k).maybeSingle();
  if (!inv || inv.revoked_at) return no("This link isn't active anymore. Reach out to the promoter.", 404);
  const [{ data: ev }, { data: nights }, { data: types }] = await Promise.all([
    db.from("events").select("id,slug,name,city,age,location_secret,address_reveal_at").eq("id", inv.event_id).single(),
    db.from("ticket_nights").select("id,label,starts_at,ends_at,sort").eq("event_id", inv.event_id).order("sort"),
    db.from("ticket_types").select("id,slug,name,night_ids,sort").eq("event_id", inv.event_id).order("sort"),
  ]);
  if (!ev) return no("Not found", 404);
  const ns = nights || [], ts = types || [];
  // A ticket can be added (or removed) until doors open on its first night.
  const firstDoors = (nightIds: string[]) => {
    const t = ns.filter((n) => nightIds.includes(n.id) && n.starts_at).map((n) => new Date(n.starts_at!).getTime());
    return t.length ? Math.min(...t) : Infinity;
  };
  const guestTypes = ts.filter((t) => t.slug !== "test" && t.slug !== "artist")
    .sort((x, y) => y.night_ids.length - x.night_ids.length || x.sort - y.sort)
    .map((t) => ({ slug: t.slug, name: t.name, id: t.id, nights: t.night_ids, open: firstDoors(t.night_ids) > Date.now() }));

  async function state() {
    const { data: orders } = await db.from("ticket_orders").select("id,name,email,phone,status,created_at").eq("artist_invite_id", inv!.id).eq("status", "comp").order("created_at");
    const ids = (orders || []).map((o) => o.id);
    const { data: tix } = ids.length ? await db.from("tickets").select("id,order_id,type_id,code,token,status").in("order_id", ids).eq("status", "valid") : { data: [] };
    const { data: scans } = tix?.length ? await db.from("ticket_scans").select("ticket_id").in("ticket_id", tix.map((t) => t.id)) : { data: [] };
    const scanned = new Set((scans || []).map((s) => s.ticket_id));
    const mine = (tix || []).find((t) => t.order_id === inv!.order_id);
    const guests = (tix || []).filter((t) => t.order_id !== inv!.order_id).map((t) => {
      const o = orders!.find((x) => x.id === t.order_id)!, ty = ts.find((x) => x.id === t.type_id);
      return { ticket_id: t.id, name: o.name, email: o.email, type: ty?.name || "Ticket", in: scanned.has(t.id),
        can_remove: !scanned.has(t.id) && firstDoors(ty?.night_ids || []) > Date.now() };
    });
    return {
      event: { name: ev!.name, city: ev!.city, age: ev!.age, nights: ns.map((n) => ({ label: n.label, starts_at: n.starts_at, ends_at: n.ends_at })) },
      artist: { name: inv!.name, claimed: !!inv!.claimed_at, email: inv!.email, spots: inv!.guest_spots, used: guests.length },
      profile: { photo_url: photoUrl(inv!.photo_path), bio: inv!.bio, hometown: inv!.hometown, genre: inv!.genre, links: cleanLinks(inv!.links), rider: inv!.rider },
      pass: mine ? { code: mine.code, url: `${SITE_URL}/ticket.html?t=${mine.token}` } : null,
      guests, types: guestTypes.map(({ slug, name, open, nights }) => ({ slug, name, open, both: nights.length > 1 })),
    };
  }

  if (a === "get") return ok(await state());

  // Same per-connection limit as checkout, so the link can't be hammered.
  const ip = await ipHash(req, (await setting("ip_salt", "unset")) + "|artist");
  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: ip });
  if ((n ?? 0) > 20) return no("Too many tries. Wait a minute and try again.", 429);

  const person = () => contact(b);
  const issue = (name: string, email: string, phone: string, typeId: string, typeName: string, tier: string, list: string, own: boolean) =>
    issueOrder(inv!, { name, email, phone }, { id: typeId, name: typeName }, tier, list, own);

  if (a === "claim") {
    if (inv.claimed_at && inv.order_id) return ok(await state());
    const p = person(); if ("err" in p) return no(p.err!);
    const t = ts.find((x) => x.slug === "artist"); if (!t) return no("Artist passes aren't set up for this show yet.");
    await db.from("artist_invites").update({ full_name: p.name, email: p.email, phone: p.phone, claimed_at: new Date().toISOString() }).eq("id", inv.id).is("claimed_at", null);
    const r = await issue(p.name, p.email, p.phone, t.id, t.name, "Artist", "Artist", true);
    if (!r) return no("Couldn't make your pass. Try again.", 500);
    inv.claimed_at = new Date().toISOString(); inv.email = p.email; inv.order_id = r.id;
    return ok({ ...(await state()), emailed: r.sent });
  }

  if (!inv.claimed_at) return no("Add your email first to get your artist pass.");

  if (a === "guest") {
    const p = person(); if ("err" in p) return no(p.err!);
    const t = guestTypes.find((x) => x.slug === b.type);
    if (!t) return no("Pick which night they're coming.");
    if (!t.open) return no("Doors are open for that night, so the guest list is closed.");
    const s = await state();
    if (s.artist.used >= inv.guest_spots) return no(`Your guest list is full (${inv.guest_spots} spots).`);
    if (s.guests.some((g) => (g.email || "").toLowerCase() === p.email)) return no("That person is already on your list.");
    const r = await issue(p.name, p.email, p.phone, t.id, t.name, "Guest list", inv.name, false);
    if (!r) return no("Couldn't add them. Try again.", 500);
    return ok({ ...(await state()), emailed: r.sent });
  }

  if (a === "remove") {
    const tid = clean(b.ticket_id, 40) || "";
    const s = await state();
    const g = s.guests.find((x) => x.ticket_id === tid);
    if (!g) return no("Not found", 404);
    if (!g.can_remove) return no(g.in ? "They're already checked in." : "Doors are open for that night, so you can't change the list.");
    await db.from("tickets").update({ status: "void" }).eq("id", tid);
    return ok(await state());
  }

  if (a === "profile") {
    const links = cleanLinks(b.links);
    // A link that was typed but couldn't be used gets named, so the artist can fix it.
    const typed = (b.links && typeof b.links === "object" ? b.links : {}) as Record<string, unknown>;
    const bad = Object.keys(LINK_HOSTS).filter((k) => clean(typed[k], 300) && !links[k]);
    if (bad.length) return no("Check your " + bad.join(" and ") + " link. Paste the full address from the app.");
    const patch = { bio: clean(b.bio, 400), hometown: clean(b.hometown, 60), genre: clean(b.genre, 60), links, rider: clean(b.rider, 1000) };
    await db.from("artist_invites").update(patch).eq("id", inv.id);
    Object.assign(inv, patch);
    return ok({ ...(await state()), saved: true });
  }

  if (a === "photo-url") {
    const ext = String(b.ext || "").toLowerCase().replace("jpeg", "jpg");
    if (!PHOTO_EXT[ext]) return no("Use a JPG, PNG or WebP photo.");
    const path = inv.id + "/" + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((x) => x.toString(16).padStart(2, "0")).join("") + "." + ext;
    const { data, error } = await db.storage.from("artist-photos").createSignedUploadUrl(path);
    if (error || !data) { console.error("artist photo-url", error?.message); return no("Couldn't start the upload. Try again.", 500); }
    return ok({ upload_url: data.signedUrl, content_type: PHOTO_EXT[ext], path });
  }

  if (a === "photo") {
    const path = clean(b.path, 200) || "";
    if (!new RegExp("^" + inv.id + "/[0-9a-f]{12}\\.(jpg|png|webp)$").test(path)) return no("That photo didn't finish uploading. Try again.");
    const old = inv.photo_path;
    await db.from("artist_invites").update({ photo_path: path }).eq("id", inv.id);
    if (old && old !== path) await db.storage.from("artist-photos").remove([old]);
    inv.photo_path = path;
    return ok(await state());
  }

  if (a === "resend") {
    if (!inv.order_id) return no("No pass yet.");
    await db.from("ticket_orders").update({ emailed_at: null }).eq("id", inv.order_id);
    return ok({ sent: await sendTickets(inv.order_id) });
  }

  return no("Unknown action", 404);
});
