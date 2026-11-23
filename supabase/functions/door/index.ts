import { db, setting } from "../_shared/db.ts";
import { json, preflight, clean, ipHash, EMAIL_RE } from "../_shared/util.ts";
import { requireAdmin } from "../_shared/admin.ts";
import { loadEvent, doorAuth, newDoorSession, pinHash, sendTickets, availability } from "../_shared/tickets.ts";

// The door page's back end. ?a= picks the action, ?e= is the event slug.
// Door staff sign in with the event's PIN and can scan, search and check people in.
// Staff signed in on /admin can also see sales, run the guest list and change settings.
const SLUG = /^[a-z0-9-]{1,80}$/;
const CORS_DOOR = { "Access-Control-Allow-Headers": "content-type, x-admin-token, x-door-token" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") { const r = preflight(req)!; return new Response(null, { status: 204, headers: { ...Object.fromEntries(r.headers), ...CORS_DOOR } }); }
  const u = new URL(req.url), a = u.searchParams.get("a") || "", slug = u.searchParams.get("e") || "";
  const ok = (body: unknown) => json(body, 200, { "Cache-Control": "no-store", ...CORS_DOOR });
  const no = (m: string, s = 400) => json({ error: m }, s, CORS_DOOR);
  let b: Record<string, unknown> = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { return no("Bad request"); } }
  if (!SLUG.test(slug)) return no("Not found", 404);
  const x = await loadEvent(slug);
  if (!x) return no("Not found", 404);
  const { ev, nights, types } = x;

  // ---- PIN -> door session (36 hours) ----
  if (a === "pin") {
    const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, (await setting("ip_salt", "unset")) + "|door") });
    if ((n ?? 0) > 8) return no("Too many tries. Wait a minute.", 429);
    const pin = (clean(b.pin, 12) || "").replace(/\D/g, "");
    if (!ev.door_pin_hash) return no("No door PIN is set for this show yet.");
    // Show-wide: more than 60 wrong tries in an hour, from anywhere, pauses PIN sign-in.
    // Phones already signed in stay signed in, and staff sign-in on /admin is unaffected.
    const failKey = "doorfail|" + ev.id;
    const { data: fails } = await db.from("rate_limits").select("count").eq("ip_hash", failKey).gt("window_start", new Date(Date.now() - 3600_000).toISOString());
    if ((fails || []).reduce((n, r) => n + (r.count as number), 0) >= 60) return no("Too many wrong PINs. Door sign-in is paused; try again later or sign in as staff.", 429);
    if (pin.length < 4 || (await pinHash(ev.id, pin)) !== ev.door_pin_hash) {
      await db.rpc("bump_rate_limit", { p_ip_hash: failKey });
      return no("Wrong PIN.");
    }
    return ok({ token: await newDoorSession(ev.id) });
  }

  const who = await doorAuth(req, ev.id);
  if (!who) return no("Sign in again.", 401);
  const typeOf = (id: string) => types.find((t) => t.id === id);
  const nightIds = (typeId: string) => typeOf(typeId)?.night_ids || [];

  // A ticket by anything a phone might scan or a person might type: the ticket link, the token or the 8-char code.
  async function findTicket(q: string) {
    q = q.trim();
    const m = q.match(/[?&]t=([0-9a-f]{48})/i) || q.match(/^([0-9a-f]{48})$/i);
    const code = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const sel = "id,code,holder_name,email,tier,is_comp,status,type_id,order_id";
    if (m) return (await db.from("tickets").select(sel).eq("event_id", ev.id).eq("token", m[1].toLowerCase()).maybeSingle()).data;
    if (code.length === 8) return (await db.from("tickets").select(sel).eq("event_id", ev.id).eq("code", code).maybeSingle()).data;
    return null;
  }
  async function listName(orderId: string) {
    const { data } = await db.from("ticket_orders").select("comp_list,promo_id").eq("id", orderId).maybeSingle();
    return data?.comp_list || null;
  }
  async function checkIn(t: { id: string; holder_name: string | null; is_comp: boolean; status: string; type_id: string; order_id: string; tier: string | null }, nightId: string) {
    const base = { name: t.holder_name, type: typeOf(t.type_id)?.name, comp: t.is_comp, list: t.is_comp ? await listName(t.order_id) : null, ticket_id: t.id };
    if (t.status !== "valid") return { result: "void", ...base };
    if (!nightIds(t.type_id).includes(nightId)) {
      const other = nights.filter((n) => nightIds(t.type_id).includes(n.id)).map((n) => n.label).join(" + ");
      return { result: "wrong_night", ...base, good_for: other };
    }
    const { error } = await db.from("ticket_scans").insert({ ticket_id: t.id, night_id: nightId, scanned_by: who!.by });
    if (error) {
      const { data: s } = await db.from("ticket_scans").select("scanned_at,scanned_by").eq("ticket_id", t.id).eq("night_id", nightId).maybeSingle();
      return { result: "used", ...base, scanned_at: s?.scanned_at || null };
    }
    return { result: "ok", ...base };
  }
  const night = (id: unknown) => nights.find((n) => n.id === id);

  // ---- what the door page needs on load ----
  if (a === "me") {
    return ok({ admin: who.admin, event: { slug: ev.slug, name: ev.name, sales_open: ev.sales_open, has_pin: !!ev.door_pin_hash },
      nights: nights.map((n) => ({ id: n.id, label: n.label, starts_at: n.starts_at, ends_at: n.ends_at })),
      types: types.map((t) => ({ slug: t.slug, name: t.name, night_ids: t.night_ids })) });
  }

  // ---- counts for one night: expected vs in ----
  if (a === "count") {
    const n = night(u.searchParams.get("n"));
    if (!n) return no("Pick a night.");
    const typeIds = types.filter((t) => t.night_ids.includes(n.id)).map((t) => t.id);
    const [{ count: expected }, { count: comps }, { count: inside }] = await Promise.all([
      db.from("tickets").select("id", { count: "exact", head: true }).eq("event_id", ev.id).eq("status", "valid").in("type_id", typeIds),
      db.from("tickets").select("id", { count: "exact", head: true }).eq("event_id", ev.id).eq("status", "valid").eq("is_comp", true).in("type_id", typeIds),
      db.from("ticket_scans").select("id", { count: "exact", head: true }).eq("night_id", n.id),
    ]);
    return ok({ expected: expected || 0, comps: comps || 0, inside: inside || 0 });
  }

  if (a === "scan") {
    const n = night(b.night);
    if (!n) return no("Pick a night first.");
    const t = await findTicket(clean(b.q, 300) || "");
    if (!t) return ok({ result: "not_found" });
    return ok(await checkIn(t, n.id));
  }

  if (a === "checkin" || a === "undo") {
    const n = night(b.night);
    const id = clean(b.ticket_id, 40) || "";
    const { data: t } = await db.from("tickets").select("id,code,holder_name,email,tier,is_comp,status,type_id,order_id").eq("event_id", ev.id).eq("id", id).maybeSingle();
    if (!n || !t) return no("Not found", 404);
    if (a === "checkin") return ok(await checkIn(t, n.id));
    await db.from("ticket_scans").delete().eq("ticket_id", t.id).eq("night_id", n.id);
    return ok({ result: "undone" });
  }

  // ---- search by name, email or code; shows whether each is in yet ----
  if (a === "search") {
    const n = night(u.searchParams.get("n"));
    const q = (u.searchParams.get("q") || "").trim().slice(0, 60);
    if (!n) return ok({ results: [] });
    // No search text = the whole list for that night, A to Z, so the door can scroll it.
    const typeIds = types.filter((t) => t.night_ids.includes(n.id)).map((t) => t.id);
    let query = db.from("tickets").select("id,code,holder_name,email,is_comp,status,type_id,order_id")
      .eq("event_id", ev.id).in("type_id", typeIds).neq("status", "void");
    if (q) { const like = `%${q.replace(/[%_,()]/g, "")}%`; query = query.or(`holder_name.ilike.${like},email.ilike.${like},code.ilike.${like}`); }
    const { data: rows } = await query.order("holder_name").limit(q ? 60 : 3000);
    // Whole-night lookups (not long id lists), so the full list stays one quick request.
    const [{ data: scans }, { data: orders }] = await Promise.all([
      db.from("ticket_scans").select("ticket_id,scanned_at").eq("night_id", n.id).limit(5000),
      db.from("ticket_orders").select("id,comp_list").eq("event_id", ev.id).not("comp_list", "is", null).limit(5000),
    ]);
    const inAt = new Map((scans || []).map((s) => [s.ticket_id, s.scanned_at]));
    const lists = new Map((orders || []).map((o) => [o.id, o.comp_list]));
    return ok({ results: (rows || []).map((r) => ({
      ticket_id: r.id, code: r.code, name: r.holder_name, email: who.admin ? r.email : null, type: typeOf(r.type_id)?.name,
      comp: r.is_comp, list: lists.get(r.order_id) || null, status: r.status,
      in_at: inAt.get(r.id) || null,
    })) });
  }

  // ================= everything below: staff signed in on /admin only =================
  if (!who.admin) return no("Staff only.", 403);
  const admin = await requireAdmin(req);
  const log = (type: string, meta: Record<string, unknown>) => db.from("engagement_events").insert({ subscriber_id: admin!.id, type: "admin:" + type, meta });

  if (a === "sales") {
    const [{ data: orders }, { data: tix }, { data: promos }, avail] = await Promise.all([
      db.from("ticket_orders").select("id,status,name,email,total_cents,discount_cents,promo_id,ref,paid_at,created_at,items").eq("event_id", ev.id).in("status", ["paid", "refunded"]).order("paid_at", { ascending: false }).limit(500),
      db.from("tickets").select("type_id,tier,unit_cents,is_comp,status").eq("event_id", ev.id).eq("status", "valid"),
      db.from("promo_codes").select("id,code,label,discount_cents,max_uses,active").eq("event_id", ev.id).order("created_at"),
      availability(types),
    ]);
    const paid = (orders || []).filter((o) => o.status === "paid");
    const byType = types.map((t) => {
      const mine = (tix || []).filter((x) => x.type_id === t.id);
      return {
        name: t.name, sold: mine.filter((x) => !x.is_comp).length, comps: mine.filter((x) => x.is_comp).length,
        tiers: t.tiers.map((tr) => ({ name: tr.name, price_cents: tr.price_cents, qty: tr.qty, sold: mine.filter((x) => !x.is_comp && x.tier === tr.name).length })),
        now: avail.find((v) => v.slug === t.slug),
      };
    });
    return ok({
      gross_cents: paid.reduce((s, o) => s + o.total_cents, 0), orders: paid.length,
      refunded: (orders || []).filter((o) => o.status === "refunded").length,
      by_type: byType,
      promos: (promos || []).map((p) => ({ ...p, orders: paid.filter((o) => o.promo_id === p.id).length,
        tickets: paid.filter((o) => o.promo_id === p.id).reduce((s, o) => s + (o.items as { qty: number }[]).reduce((q, i) => q + i.qty, 0), 0) })),
      recent: paid.slice(0, 50).map((o) => ({ name: o.name, email: o.email, total_cents: o.total_cents, paid_at: o.paid_at,
        qty: (o.items as { qty: number }[]).reduce((q, i) => q + i.qty, 0), promo: promos?.find((p) => p.id === o.promo_id)?.code || null })),
      sales_open: ev.sales_open, has_pin: !!ev.door_pin_hash,
    });
  }

  // ---- door list: every valid ticket for the show (paid, guest list, artists, artists' guests) ----
  if (a === "guests") {
    const { data: rows } = await db.from("tickets").select("id,code,holder_name,email,type_id,order_id,status,is_comp").eq("event_id", ev.id).eq("status", "valid").order("holder_name").limit(5000);
    // Whole-show lookups (not long id lists), so a big list stays one quick request.
    const [{ data: orders }, { data: scans }] = await Promise.all([
      db.from("ticket_orders").select("id,comp_list,phone,artist_invite_id").eq("event_id", ev.id).in("status", ["paid", "comp"]).limit(5000),
      db.from("ticket_scans").select("ticket_id,night_id").in("night_id", nights.map((n) => n.id)).limit(10000),
    ]);
    const om = new Map((orders || []).map((o) => [o.id, o]));
    const inN = new Map<string, string[]>();
    for (const s of scans || []) inN.set(s.ticket_id, [...(inN.get(s.ticket_id) || []), s.night_id]);
    return ok({ guests: (rows || []).filter((r) => typeOf(r.type_id)?.slug !== "test").map((r) => {
      const o = om.get(r.order_id), ty = typeOf(r.type_id);
      const kind = ty?.slug === "artist" ? "artist" : r.is_comp && o?.artist_invite_id ? "artist_guest" : r.is_comp ? "guest" : "paid";
      return { ticket_id: r.id, code: r.code, name: r.holder_name, email: r.email, type: ty?.name, kind, comp: r.is_comp,
        list: o?.comp_list || null, phone: o?.phone || null,
        nights: (ty?.night_ids || []).map((id) => ({ label: nights.find((n) => n.id === id)?.label || "", in: (inN.get(r.id) || []).includes(id) })) };
    }) });
  }

  if (a === "comp") {
    // Guest list is always the both-nights pass when the show has one (the staff page sends no type).
    const t = types.find((t) => t.slug === b.type) || types.find((t) => t.slug !== "test" && t.slug !== "artist" && t.night_ids.length > 1);
    if (!t) return no("Pick which night.");
    const list = clean(b.list, 40);
    const phoneOf = (v: unknown) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length === 10 ? "+1" + d : d.length === 11 && d[0] === "1" ? "+" + d : d.length >= 11 && d.length <= 15 ? "+" + d : null; };
    const people = (Array.isArray(b.people) ? b.people : []).slice(0, 100)
      .map((p: Record<string, unknown>) => ({ name: clean(p.name, 80), email: (clean(p.email, 254) || "").toLowerCase() || null, phone: p.phone ? phoneOf(p.phone) : null, rawPhone: !!p.phone }))
      .filter((p) => p.name);
    if (!people.length) return no("Add at least one name.");
    // The staff page's guest form checks like checkout: full name, a real email, a phone we can reach.
    if (b.strict === true) for (const p of people) {
      if (p.name!.trim().split(/\s+/).length < 2) return no("Enter their full name (first and last).");
      if (!p.email || !EMAIL_RE.test(p.email)) return no("Enter the email their ticket should go to.");
      if (!p.phone) return no("Enter a phone number we can reach them at.");
    }
    let emailed = 0;
    for (const p of people) {
      const email = p.email && EMAIL_RE.test(p.email) ? p.email : null;
      const { data: o, error } = await db.from("ticket_orders").insert({
        event_id: ev.id, status: "pending", email, name: p.name, phone: p.phone, comp_list: list, created_by: admin!.id,
        items: [{ type_id: t.id, name: t.name, tier: "Guest list", unit_cents: 0, qty: 1 }],
      }).select("id").single();
      if (error || !o) return no("Couldn't add " + p.name);
      await db.rpc("ticket_issue", { p_order: o.id, p_status: "comp" });
      if (email && (await sendTickets(o.id))) emailed++;
    }
    await log("comp", { event: ev.slug, type: t.slug, list, count: people.length });
    return ok({ added: people.length, emailed });
  }

  if (a === "void") {
    const id = clean(b.ticket_id, 40) || "";
    const { data: t } = await db.from("tickets").select("id,is_comp").eq("event_id", ev.id).eq("id", id).maybeSingle();
    if (!t) return no("Not found", 404);
    if (!t.is_comp) return no("Paid tickets are cancelled by refunding them in Stripe.");
    await db.from("tickets").update({ status: "void" }).eq("id", t.id);
    await log("comp_void", { event: ev.slug, ticket: t.id });
    return ok({ voided: true });
  }

  if (a === "settings") {
    const patch: Record<string, unknown> = {};
    if (typeof b.sales_open === "boolean") patch.sales_open = b.sales_open;
    if (b.pin !== undefined) {
      const pin = String(b.pin || "").replace(/\D/g, "");
      if (pin.length < 4 || pin.length > 8) return no("PIN must be 4 to 8 digits.");
      patch.door_pin_hash = await pinHash(ev.id, pin);
      await db.from("door_sessions").delete().eq("event_id", ev.id);   // a new PIN signs every door phone out
    }
    if (!Object.keys(patch).length) return no("Nothing to change.");
    await db.from("events").update(patch).eq("id", ev.id);
    await log("ticket_settings", { event: ev.slug, sales_open: patch.sales_open, pin_changed: !!patch.door_pin_hash });
    return ok({ saved: true });
  }

  if (a === "promo") {
    const code = (clean(b.code, 30) || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (code.length < 3) return no("Code needs at least 3 letters or numbers.");
    const discount = Math.max(0, Math.round(Number(b.discount_dollars || 0) * 100));
    const { error } = await db.from("promo_codes").upsert({ event_id: ev.id, code, label: clean(b.label, 60), discount_cents: discount,
      max_uses: b.max_uses ? Math.max(1, Math.floor(Number(b.max_uses))) : null, active: b.active !== false }, { onConflict: "event_id,code" });
    if (error) return no("Couldn't save that code.");
    await log("promo", { event: ev.slug, code, discount });
    return ok({ saved: true });
  }

  if (a === "resend") {
    const id = clean(b.ticket_id, 40) || "";
    const { data: t } = await db.from("tickets").select("order_id").eq("event_id", ev.id).eq("id", id).maybeSingle();
    if (!t) return no("Not found", 404);
    await db.from("ticket_orders").update({ emailed_at: null }).eq("id", t.order_id);
    return ok({ sent: await sendTickets(t.order_id) });
  }

  return no("Unknown action");
});
