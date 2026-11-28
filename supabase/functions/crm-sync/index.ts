// Keeps Brevo's contacts matching everyone on the site, on its own (a database timer calls this every
// 10 minutes). Ticket buyers, guest list, artists, artist members, site members and promoter signups are each added or
// updated once, tagged with ROLE (Artist / Buyer / Guest / Promoter / Member) and SHOW, and put on one list,
// "Subduction - Everyone", which this creates the first time. Artist waitlist signups are the exception:
// they are tagged Artist and are not put on any list, so no list welcome can send. Failures stay unsynced
// and retry next run. The only import is the pure role and phone helper. This never sends mail.
//   POST ?a=run   (x-runner-secret)   sync whoever is new since the last run
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { smsNumber, subscriberRole } from "../artist-waitlist/contact.mjs";
import { sameSecret } from "../_shared/secret.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? fallback) as T;
}
const BREVO = "https://api.brevo.com/v3";
const LIST_NAME = "Subduction - Everyone";
const ATTRS = ["ROLE", "SHOW", "SOURCE"];

type Person = { email: string; name: string | null; phone: string | null; role: string; show: string | null; source: string };

Deno.serve(async (req) => {
  const secret = await setting<string | null>("runner_secret", null);
  if (!sameSecret(req.headers.get("x-runner-secret"), secret)) return json({ error: "Not allowed" }, 401);
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) return json({ error: "BREVO_API_KEY not set" }, 500);
  const H = { "api-key": key, "Content-Type": "application/json", "Accept": "application/json" };
  const brevo = (path: string, method = "GET", body?: unknown) => fetch(BREVO + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }).catch(() => null);

  // One-time setup: our text attributes and the "everyone" list (in the first folder, or a new one).
  let listId = await setting<number | null>("brevo_all_list_id", null);
  if (!listId) {
    for (const a of ATTRS) await brevo(`/contacts/attributes/normal/${a}`, "POST", { type: "text" });
    let folderId: number | null = null;
    const f = await brevo("/contacts/folders?limit=10");
    if (f?.ok) folderId = ((await f.json()).folders || [])[0]?.id ?? null;
    if (!folderId) { const nf = await brevo("/contacts/folders", "POST", { name: "Subduction" }); if (nf?.ok) folderId = (await nf.json()).id; }
    const l = await brevo("/contacts/lists", "POST", { name: LIST_NAME, folderId });
    if (!l?.ok) return json({ error: "Couldn't make the Brevo list", detail: (await l?.text().catch(() => ""))?.slice(0, 200) }, 500);
    listId = (await l.json()).id;
    await db.from("settings").upsert({ key: "brevo_all_list_id", value: listId, updated_at: new Date().toISOString() });
  }
  const newsletter = await setting<number | null>("brevo_list_id", null);

  // One person can be several things (an artist who also has a site account, a buyer who joined the
  // waitlist). The strongest label wins and a weaker step never overwrites it.
  // Artist > Buyer > Guest > Promoter = Member. A promoter never overwrites a buyer, a guest or an artist.
  const RANK: Record<string, number> = { Artist: 4, Buyer: 3, Guest: 2, Promoter: 1, Member: 1 };
  const best = new Map<string, string>();
  const note = (email: string | null, role: string) => {
    const e = String(email || "").trim().toLowerCase(); if (!e) return;
    if ((RANK[role] || 0) > (RANK[best.get(e) || ""] || 0)) best.set(e, role);
  };
  for (const r of (await db.from("artist_waitlist").select("email")).data || []) note(r.email, "Artist");
  for (const r of (await db.from("artist_invites").select("email").is("revoked_at", null).not("email", "is", null)).data || []) note(r.email, "Artist");
  for (const r of (await db.from("artist_members").select("email").is("revoked_at", null)).data || []) note(r.email, "Artist");
  for (const r of (await db.from("ticket_orders").select("email,status").in("status", ["paid", "comp"]).not("email", "is", null)).data || []) note(r.email, r.status === "paid" ? "Buyer" : "Guest");
  const pleads = await db.from("promoter_leads").select("email");
  if (pleads.error) console.error("crm-sync: promoter leads", pleads.error.message);
  else for (const r of pleads.data || []) note(r.email, "Promoter");

  // withList is false for the artist waitlist and for a promoter label correction, so those writes
  // never add a list. Everyone else still goes on the everyone list, same as before.
  async function upsert(p: Person, withNewsletter: boolean, withList = true) {
    const [first, ...rest] = (p.name || "").trim().split(/\s+/);
    // Someone known as something stronger keeps that label (and its source); this step only fills in the rest.
    const top = best.get(p.email.trim().toLowerCase());
    const weaker = !!top && (RANK[top] || 0) > (RANK[p.role] || 0);
    const attrs: Record<string, unknown> = { FIRSTNAME: first || undefined, LASTNAME: rest.join(" ") || undefined, SHOW: p.show || undefined,
      ...(weaker ? {} : { ROLE: p.role, SOURCE: p.source }) };
    const lists = withList ? [listId!, ...(withNewsletter && newsletter ? [newsletter] : [])] : null;
    const send = (withSms: boolean) => brevo("/contacts", "POST", { email: p.email, updateEnabled: true, ...(lists ? { listIds: lists } : {}),
      attributes: withSms && p.phone ? { ...attrs, SMS: p.phone } : attrs });
    let r = await send(true);
    // A phone Brevo rejects (or one already on another contact) must not block the rest.
    if (r && !r.ok && p.phone) { const t = await r.clone().text().catch(() => ""); if (/sms|phone/i.test(t)) r = await send(false); }
    return !!r && (r.ok || r.status === 204);
  }

  const now = new Date().toISOString();
  let synced = 0, failed = 0;
  const shows: Record<string, string> = {};
  const showName = async (id: string) => shows[id] ??= ((await db.from("events").select("name").eq("id", id).maybeSingle()).data?.name || "");

  // Ticket holders: buyers and guest list (test tickets and the artist's own pass are skipped here).
  const { data: orders } = await db.from("ticket_orders").select("id,event_id,email,name,phone,status,comp_list,artist_invite_id")
    .in("status", ["paid", "comp"]).is("crm_synced_at", null).not("email", "is", null).limit(150);
  for (const o of orders || []) {
    if (/^test$/i.test(o.comp_list || "") || (o.artist_invite_id && (!o.comp_list || o.comp_list === "Artist"))) {
      await db.from("ticket_orders").update({ crm_synced_at: now }).eq("id", o.id); continue;
    }
    const ok = await upsert({ email: o.email, name: o.name, phone: o.phone, role: o.status === "paid" ? "Buyer" : "Guest", show: await showName(o.event_id), source: "tickets" }, false);
    if (ok) { synced++; await db.from("ticket_orders").update({ crm_synced_at: now }).eq("id", o.id); } else failed++;
  }
  // Artist waitlist. Same contact write, with no list, so nothing here can send them mail.
  // Runs before booked artists so a pass holder keeps that source when they are also on the waitlist.
  const { data: waiting, error: waitErr } = await db.from("artist_waitlist").select("id,email,full_name,artist_name,phone").is("crm_synced_at", null).limit(40);
  if (waitErr) console.error("crm-sync waitlist", waitErr.message);
  for (const w of waiting || []) {
    const ok = await upsert({ email: w.email, name: w.full_name || w.artist_name, phone: smsNumber(w.phone), role: "Artist", show: null, source: "artist-waitlist" }, false, false);
    if (ok) { synced++; await db.from("artist_waitlist").update({ crm_synced_at: now }).eq("id", w.id); } else failed++;
  }
  // Artists (the person on the pass) and duo/group members.
  const { data: invs } = await db.from("artist_invites").select("id,event_id,email,full_name,phone,name").is("crm_synced_at", null).is("revoked_at", null).not("email", "is", null).limit(100);
  for (const v of invs || []) {
    const ok = await upsert({ email: v.email, name: v.full_name || v.name, phone: v.phone, role: "Artist", show: await showName(v.event_id), source: "artist:" + v.name }, false);
    if (ok) { synced++; await db.from("artist_invites").update({ crm_synced_at: now }).eq("id", v.id); } else failed++;
  }
  const { data: mems } = await db.from("artist_members").select("id,email,full_name,phone,inv:artist_invites(event_id,name)").is("crm_synced_at", null).is("revoked_at", null).limit(100);
  for (const m of mems || []) {
    const inv = (m as unknown as { inv: { event_id: string; name: string } | null }).inv;
    const ok = await upsert({ email: m.email, name: m.full_name, phone: m.phone, role: "Artist", show: inv ? await showName(inv.event_id) : null, source: "artist:" + (inv?.name || "") }, false);
    if (ok) { synced++; await db.from("artist_members").update({ crm_synced_at: now }).eq("id", m.id); } else failed++;
  }
  // Site members (waitlist / accounts): also go on the newsletter list if one is picked in admin.
  // A crew account is a promoter. That is why a promoter used to land as Member: this step labeled every subscriber Member.
  const staffIds = new Set<string>(((await db.from("company_staff").select("subscriber_id")).data || []).map((r) => r.subscriber_id as string));
  const { data: subs } = await db.from("subscribers").select("id,email,first_name,phone,source").eq("status", "active").is("crm_synced_at", null).limit(150);
  for (const s of subs || []) {
    const role = subscriberRole(s.source, staffIds.has(s.id));
    const ok = await upsert({ email: s.email, name: s.first_name, phone: s.phone, role, show: null, source: s.source || "site" }, true);
    if (ok) {
      synced++;
      const up = await db.from("subscribers").update({ crm_synced_at: now, crm_role: role }).eq("id", s.id);
      // Keep the sync stamp even if the role column is not there yet, so this does not add the same person to a list again.
      if (up.error) { console.error("crm-sync member stamp", up.error.message); await db.from("subscribers").update({ crm_synced_at: now }).eq("id", s.id); }
    } else failed++;
  }
  // Promoter emails from the sign-in screen. A missing table (migration not run yet) must not stop the rest.
  // Artist contacts are never written from this loop. Their pass mail is sent elsewhere.
  const artistEmails = new Set<string>();
  const [invAll, memAll] = await Promise.all([
    db.from("artist_invites").select("email").not("email", "is", null),
    db.from("artist_members").select("email"),
  ]);
  const artistKnown = !invAll.error && !memAll.error;
  if (!artistKnown) console.error("crm-sync: artist list", invAll.error?.message || memAll.error?.message);
  else {
    for (const r of invAll.data || []) { const e = String(r.email || "").trim().toLowerCase(); if (e) artistEmails.add(e); }
    for (const r of memAll.data || []) { const e = String(r.email || "").trim().toLowerCase(); if (e) artistEmails.add(e); }
  }
  const leads = await db.from("promoter_leads").select("id,email,source,utm_source").is("crm_synced_at", null).order("created_at", { ascending: false }).limit(300);
  if (leads.error) console.error("crm-sync: promoter leads", leads.error.message);
  // A lead is just an address someone typed. It goes to Brevo only once it has an active subscriber row
  // (the inbox was proven at sign-in). Others are left alone and checked again next run.
  const activeLeads = new Set<string>();
  const leadAddrs = (leads.data || []).map((l) => String(l.email || "").trim().toLowerCase()).filter(Boolean);
  if (leadAddrs.length) {
    const act = await db.from("subscribers").select("email").eq("status", "active").in("email", leadAddrs);
    if (act.error) console.error("crm-sync: lead check", act.error.message);
    for (const r of act.data || []) activeLeads.add(String(r.email || "").trim().toLowerCase());
  }
  for (const l of (leads.data || []).filter((x) => activeLeads.has(String(x.email || "").trim().toLowerCase())).slice(0, 100)) {
    const addr = String(l.email || "").trim().toLowerCase();
    if (!artistKnown) { failed++; continue; }
    if (artistEmails.has(addr)) { await db.from("promoter_leads").update({ crm_synced_at: now }).eq("id", l.id); continue; }
    const ok = await upsert({ email: l.email, name: null, phone: null, role: "Promoter", show: null, source: l.utm_source || l.source || "promoter" }, false);
    if (ok) { synced++; await db.from("promoter_leads").update({ crm_synced_at: now }).eq("id", l.id); } else failed++;
  }

  // Promoters already in Brevo with the old Member label. Attribute update only, so this does not add a list.
  const roleFilter = "crm_role.is.null,crm_role.neq.Promoter";
  const correct = async (rows: Array<{ id: string; email: string; first_name: string | null; phone: string | null; source: string | null }> | null) => {
    for (const s of rows || []) {
      const ok = await upsert({ email: s.email, name: s.first_name, phone: s.phone, role: subscriberRole(s.source, true), show: null, source: s.source || "promoter" }, false, false);
      if (ok) { synced++; await db.from("subscribers").update({ crm_role: "Promoter" }).eq("id", s.id); } else failed++;
    }
  };
  const bySource = await db.from("subscribers").select("id,email,first_name,phone,source").eq("status", "active").in("source", ["promoter", "promoter-open"]).not("crm_synced_at", "is", null).or(roleFilter).limit(50);
  if (bySource.error) console.error("crm-sync promoters", bySource.error.message);
  else await correct(bySource.data);
  if (staffIds.size) {
    const byStaff = await db.from("subscribers").select("id,email,first_name,phone,source").eq("status", "active").in("id", [...staffIds]).not("crm_synced_at", "is", null).or(roleFilter).limit(50);
    if (byStaff.error) console.error("crm-sync promoters", byStaff.error.message);
    else {
      const seen = new Set((bySource.data || []).map((s) => s.id));
      await correct((byStaff.data || []).filter((s) => !seen.has(s.id)));
    }
  }

  return json({ synced, failed, list_id: listId });
});
