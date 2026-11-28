// Artist waitlist: an artist leaves their artist name, full name, email and phone.
// Saves the row, adds a Brevo contact with ROLE Artist (no list, no welcome, no confirmation mail),
// and tells Dylan once. Repeat signups update the same row and do not send another alert.
// The artist is never emailed from here. Self-contained aside from the pure contact helper,
// so a deploy of this function cannot pull in ticketing code.
import { ipFromHeaders } from "../_shared/client_ip.mjs";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { artistContactBody, smsNumber } from "./contact.mjs";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = (Deno.env.get("SITE_URL") || "https://subduction.art").replace(/\/$/, "");
const CONTACT = "hello@subduction.art";
const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : null) || null;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function ipHash(req: Request) {
  const ip = ipFromHeaders((h) => req.headers.get(h));
  const { data } = await db.from("settings").select("value").eq("key", "ip_salt").maybeSingle();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + String(data?.value ?? "unset")));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function admins() {
  const { data } = await db.from("settings").select("value").eq("key", "admin_emails").maybeSingle();
  const list = Array.isArray(data?.value) ? data.value : [];
  return list.map((e) => String(e).toLowerCase()).filter((e) => EMAIL_RE.test(e));
}

// Same contact write crm-sync uses, minus every list. /v3/contacts does not send mail.
// The double opt-in endpoint is never called.
async function syncContact(row: { email: string; artist_name: string | null; full_name: string | null; phone: string | null }) {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) { console.error("artist-waitlist: BREVO_API_KEY not set"); return false; }
  const phone = smsNumber(row.phone);
  const post = (withSms: boolean) => fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(artistContactBody({ email: row.email, name: row.full_name || row.artist_name, phone }, withSms)),
  });
  try {
    let r = await post(true);
    if (!r.ok && phone) {
      const t = await r.clone().text().catch(() => "");
      if (/sms|phone/i.test(t)) r = await post(false);
    }
    if (r.ok || r.status === 204) return true;
    console.error("artist-waitlist: contact sync failed", r.status);
    return false;
  } catch (e) {
    console.error("artist-waitlist: contact sync failed", (e as Error).message);
    return false;
  }
}

// Same notice as "New promoter account": one plain mail to the staff list, reply goes to the artist.
async function ping(row: { artist_name: string | null; full_name: string | null; email: string; phone: string | null }) {
  try {
    const key = Deno.env.get("BREVO_API_KEY");
    const adminsTo = await admins();
    if (!key || !adminsTo.length) return false;
    const subject = `New artist signup: ${row.artist_name || row.full_name || row.email}`;
    const text = [subject, "", `Artist: ${row.artist_name || ""}`, `Name: ${row.full_name || ""}`, `Email: ${row.email}`, `Phone: ${row.phone || ""}`, "", "Artist waitlist: " + SITE + "/people.html"].join("\n");
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Subduction leads", email: Deno.env.get("FROM_EMAIL") || CONTACT },
        replyTo: { email: row.email },
        to: adminsTo.map((email) => ({ email })),
        subject,
        textContent: text,
        htmlContent: "<pre style=\"font:15px/1.6 Arial,sans-serif\">" + esc(text) + "</pre>",
        tags: ["lead"],
      }),
    });
    if (!r.ok) { console.error("artist-waitlist: alert failed", r.status); return false; }
    return true;
  } catch (e) {
    console.error("artist-waitlist: alert failed", (e as Error).message);
    return false;
  }
}

// Claim the one alert. A second signup finds the stamp and sends nothing.
async function alertOnce(id: string, row: { artist_name: string | null; full_name: string | null; email: string; phone: string | null }) {
  const { data: claimed } = await db.from("artist_waitlist").update({ alerted_at: new Date().toISOString() }).eq("id", id).is("alerted_at", null).select("id");
  if (!claimed?.length) return;
  if (!(await ping(row))) await db.from("artist_waitlist").update({ alerted_at: null }).eq("id", id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  // Bots fill the hidden field. Humans never see it. Pretend it worked.
  if (clean(b.hp, 200)) return json({ ok: true });

  const email = (clean(b.email, 254) || "").toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "That email doesn't look right." }, 400);

  const ip = await ipHash(req);
  const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: ip });
  if ((n ?? 0) > 20) return json({ error: "Slow down a sec and try again." }, 429);

  const fields = {
    email,
    artist_name: clean(b.artist_name, 80),
    full_name: clean(b.full_name, 80),
    phone: (clean(b.phone, 30) || "").replace(/[^0-9+()\-. ]/g, "") || null,
    ip_hash: ip,
  };

  // Same email updates the name and phone. The form still says they are on the list either way.
  const { data: existing, error: readErr } = await db.from("artist_waitlist").select("id,alerted_at").eq("email", email).maybeSingle();
  if (readErr) { console.error("artist_waitlist", readErr.message); return json({ error: "Couldn't save that. Try again." }, 500); }

  let id = existing?.id as string | undefined;
  if (existing) {
    const { error } = await db.from("artist_waitlist").update(fields).eq("id", existing.id);
    if (error) { console.error("artist_waitlist", error.message); return json({ error: "Couldn't save that. Try again." }, 500); }
  } else {
    const ins = await db.from("artist_waitlist").insert(fields).select("id").single();
    if (ins.error?.code === "23505") {
      const again = await db.from("artist_waitlist").select("id").eq("email", email).maybeSingle();
      id = again.data?.id;
      if (!id) return json({ error: "Couldn't save that. Try again." }, 500);
      const { error } = await db.from("artist_waitlist").update(fields).eq("id", id);
      if (error) { console.error("artist_waitlist", error.message); return json({ error: "Couldn't save that. Try again." }, 500); }
    } else if (ins.error || !ins.data) {
      console.error("artist_waitlist", ins.error?.message);
      return json({ error: "Couldn't save that. Try again." }, 500);
    } else {
      id = ins.data.id;
    }
  }

  if (!id) return json({ error: "Couldn't save that. Try again." }, 500);
  if (await syncContact(fields)) await db.from("artist_waitlist").update({ crm_synced_at: new Date().toISOString() }).eq("id", id);
  await alertOnce(id, fields);
  return json({ ok: true });
});
