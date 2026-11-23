import { db, setting } from "../_shared/db.ts";
import { json, preflight, clean, ipHash, EMAIL_RE } from "../_shared/util.ts";
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
// Staff side (signed in on /admin, x-admin-token):
//   GET  ?a=list&e=slug      every invite for a show with its guests
//   POST {a:"create",e,...}  name + guest spots -> the private link to text them
//   POST {a:"update",id,...} change name or guest spots
//   POST {a:"revoke",id}     link stops working; their pass and their guests' tickets are cancelled
const TOKEN = /^[0-9a-f]{48}$/, SLUG = /^[a-z0-9-]{1,80}$/;
const CORS_A = { "Access-Control-Allow-Headers": "content-type, x-admin-token" };
const phoneOf = (v: unknown) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 10 ? "+1" + d : d.length === 11 && d[0] === "1" ? "+" + d : d.length >= 11 && d.length <= 15 ? "+" + d : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") { const r = preflight(req)!; return new Response(null, { status: 204, headers: { ...Object.fromEntries(r.headers), ...CORS_A } }); }
  const u = new URL(req.url);
  if (u.searchParams.get("a") === "ping") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });   // staff page warm-up
  let b: Record<string, unknown> = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { return no("Bad request"); } }
  const a = String(b.a || u.searchParams.get("a") || "");
  function ok(body: unknown) { return json(body, 200, { "Cache-Control": "no-store", ...CORS_A }); }
  function no(m: string, s = 400) { return json({ error: m }, s, CORS_A); }

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
        const { data: inv, error } = await db.from("artist_invites").insert({ event_id: ev.id, name, guest_spots: spots, created_by: admin.id }).select("id,token").single();
        if (error || !inv) return no("Couldn't save that artist.", 500);
        await log("artist_invite", { event: slug, name, spots });
        return ok({ id: inv.id, link: `${SITE_URL}/artist.html?k=${inv.token}` });
      }
      const { data: invs } = await db.from("artist_invites").select("id,name,token,guest_spots,email,claimed_at,revoked_at,order_id,created_at").eq("event_id", ev.id).order("created_at");
      const ids = (invs || []).map((i) => i.id);
      const { data: orders } = ids.length ? await db.from("ticket_orders").select("id,artist_invite_id,name,email,status").in("artist_invite_id", ids).eq("status", "comp") : { data: [] };
      const { data: tix } = orders?.length ? await db.from("tickets").select("order_id,status,type_id").in("order_id", orders.map((o) => o.id)).eq("status", "valid") : { data: [] };
      const live = new Set((tix || []).map((t) => t.order_id));
      return ok({ artists: (invs || []).map((i) => {
        const guests = (orders || []).filter((o) => o.artist_invite_id === i.id && o.id !== i.order_id && live.has(o.id));
        return { id: i.id, name: i.name, spots: i.guest_spots, email: i.email, claimed: !!i.claimed_at, revoked: !!i.revoked_at,
          link: `${SITE_URL}/artist.html?k=${i.token}`, guests: guests.map((g) => ({ name: g.name, email: g.email })) };
      }) });
    }
    const id = clean(b.id, 40) || "";
    const { data: inv } = await db.from("artist_invites").select("id,event_id,name,order_id").eq("id", id).maybeSingle();
    if (!inv) return no("Not found", 404);
    if (a === "update") {
      const patch: Record<string, unknown> = {};
      if (b.spots !== undefined) patch.guest_spots = Math.max(0, Math.min(50, Math.floor(Number(b.spots))));
      if (typeof b.name === "string" && clean(b.name, 80)) patch.name = clean(b.name, 80);
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
  const { data: inv } = await db.from("artist_invites").select("id,event_id,name,guest_spots,email,phone,order_id,claimed_at,revoked_at").eq("token", k).maybeSingle();
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
      pass: mine ? { code: mine.code, url: `${SITE_URL}/ticket.html?t=${mine.token}` } : null,
      guests, types: guestTypes.map(({ slug, name, open, nights }) => ({ slug, name, open, both: nights.length > 1 })),
    };
  }

  if (a === "get") return ok(await state());

  // Same per-connection limit as checkout, so the link can't be hammered.
  const ip = await ipHash(req, (await setting("ip_salt", "unset")) + "|artist");
  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: ip });
  if ((n ?? 0) > 20) return no("Too many tries. Wait a minute and try again.", 429);

  const person = () => {
    const name = (clean(b.name, 80) || "").replace(/\s+/g, " ");
    const email = (clean(b.email, 254) || "").toLowerCase();
    const phone = phoneOf(b.phone);
    if (name.split(" ").length < 2) return { err: "Enter the full name (first and last)." };
    if (!EMAIL_RE.test(email)) return { err: "Enter a real email address." };
    if (!phone) return { err: "Enter a phone number we can reach." };
    return { name, email, phone };
  };
  async function issue(name: string, email: string, phone: string, typeId: string, typeName: string, tier: string, list: string, own: boolean) {
    const { data: o, error } = await db.from("ticket_orders").insert({
      event_id: ev!.id, status: "pending", email, name, phone, comp_list: list, artist_invite_id: inv!.id,
      items: [{ type_id: typeId, name: typeName, tier, unit_cents: 0, qty: 1 }],
    }).select("id").single();
    if (error || !o) return null;
    if (own) await db.from("artist_invites").update({ order_id: o.id }).eq("id", inv!.id);
    await db.rpc("ticket_issue", { p_order: o.id, p_status: "comp" });
    const sent = await sendTickets(o.id);
    return { id: o.id, sent };
  }

  if (a === "claim") {
    if (inv.claimed_at && inv.order_id) return ok(await state());
    const p = person(); if ("err" in p) return no(p.err!);
    const t = ts.find((x) => x.slug === "artist"); if (!t) return no("Artist passes aren't set up for this show yet.");
    await db.from("artist_invites").update({ email: p.email, phone: p.phone, claimed_at: new Date().toISOString() }).eq("id", inv.id).is("claimed_at", null);
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

  if (a === "resend") {
    if (!inv.order_id) return no("No pass yet.");
    await db.from("ticket_orders").update({ emailed_at: null }).eq("id", inv.order_id);
    return ok({ sent: await sendTickets(inv.order_id) });
  }

  return no("Unknown action", 404);
});
