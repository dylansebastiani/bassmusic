// Emails the venue name and address to every paid ticket holder of a secret-location promoter show,
// once, when its reveal time passes. A database timer calls this every 15 minutes (migration 0055).
//   POST (x-runner-secret)   send whatever is due; safe to rerun. Each order is claimed in ticket_orders.location_sent_at
//                            before it sends and released if the send fails; events.reveal_sent_at closes the show.
// T.O.F.T.U. (slug underground) is never selected here: it sends its own emails. Self-contained like `checkout`.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { TOFTU_ID, TOFTU_SLUG, isToftu, runReveal } from "./core.mjs";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = (Deno.env.get("SITE_URL") || "https://subduction.art").replace(/\/$/, "");
const CONTACT = Deno.env.get("CONTACT_EMAIL") || "hello@subduction.art";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function sendOne(ev: any, o: any, where: { venue: string; address: string }) {
  if (isToftu(ev)) return false;                       // explicit guard: T.O.F.T.U. sends its own emails
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key || !o.email) return false;
  const [{ data: tix }, { data: co }] = await Promise.all([
    db.from("tickets").select("code,token").eq("order_id", o.id).eq("status", "valid").order("created_at"),
    db.from("companies").select("name,contact_email").eq("id", ev.company_id).maybeSingle(),
  ]);
  if (!tix?.length) return false;
  const by = co?.name || ev.name, reply = co?.contact_email || CONTACT;
  const first = (o.name || "").trim().split(/\s+/)[0] || "there";
  const maps = "https://maps.google.com/?q=" + encodeURIComponent(where.address);
  const links = tix.map((t) => ({ code: t.code, url: `${SITE}/pass.html?t=${t.token}` }));
  const subject = `The address is in: ${ev.name}`;
  const mailing = String(await setting("mailing_address", "PO Box TBD, Bloomington, IL 61701"));
  const F = "font-family:Arial,Helvetica,sans-serif";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#0a0a0a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111110;border:1px solid #2b2927">
<tr><td style="padding:28px 24px 6px;${F};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#9a958f">${esc(by)}</td></tr>
<tr><td style="padding:0 24px;${F};font-size:28px;line-height:1.15;font-weight:bold;color:#f4f1ee">${esc(ev.name)}</td></tr>
<tr><td style="padding:14px 24px 0;${F};font-size:15px;line-height:1.6;color:#d9d5cf">Hi ${esc(first)}, the location is in.</td></tr>
<tr><td style="padding:10px 24px 0;${F};font-size:18px;line-height:1.5;font-weight:bold;color:#f4f1ee">${where.venue ? esc(where.venue) + "<br>" : ""}${esc(where.address)}<br><a href="${maps}" style="${F};font-size:13px;font-weight:normal;color:#f4f1ee">Open in Maps</a></td></tr>
<tr><td style="padding:16px 24px 0;${F};font-size:14px;line-height:1.8;color:#9a958f">${links.map((l) => `<a href="${l.url}" style="color:#f4f1ee">Your ticket ${esc(l.code)}</a>`).join("<br>")}</td></tr>
<tr><td style="padding:14px 24px 0;${F};font-size:14px;line-height:1.6;color:#9a958f">Please keep the address to yourself.</td></tr>
<tr><td style="padding:22px 24px 26px;${F};font-size:12px;line-height:1.6;color:#6f6b66">Questions about the show? Reply to this email.<br>${esc(by)} · ${esc(mailing)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`${ev.name} (${by})`, "", `Hi ${first}, the location is in.`, [where.venue, where.address].filter(Boolean).join(", "), maps, "",
    ...links.map((l) => `Your ticket ${l.code}: ${l.url}`), "", "Please keep the address to yourself.", "Questions about the show? Reply to this email.", `${by} · ${mailing}`].join("\n");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: `${by} Tickets`.slice(0, 70), email: Deno.env.get("FROM_EMAIL") || "hello@subduction.art" }, replyTo: { email: reply },
      to: [{ email: o.email, name: o.name || undefined }], subject, htmlContent: html, textContent: text, tags: ["address-reveal"] }) });
  if (!r.ok) console.error("reveal: email failed", o.id, r.status, (await r.text().catch(() => "")).slice(0, 200));
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Not allowed" }, 405);
  const secret = await setting<string>("runner_secret", "");
  if (!sameSecret(req.headers.get("x-runner-secret") || "", secret)) return json({ error: "Not allowed" }, 401);
  const now = new Date();
  const res = await runReveal({
    // The query already leaves T.O.F.T.U. out; core.mjs (also the handsOff rule) and sendOne check again.
    events: async () => (await db.from("events")
      .select("id,slug,name,company_id,venue,address,venue_full,address_full,location_secret,address_reveal_at,reveal_sent_at,company:companies(slug,legacy_stripe)")
      .eq("location_secret", true).is("reveal_sent_at", null).not("address_reveal_at", "is", null).lte("address_reveal_at", now.toISOString())
      .neq("slug", TOFTU_SLUG).neq("id", TOFTU_ID).limit(50)).data || [],
    orders: async (eventId: string) => (await db.from("ticket_orders").select("id,email,name").eq("event_id", eventId)
      .in("status", ["paid", "comp"]).not("email", "is", null).is("location_sent_at", null).limit(500)).data || [],
    claim: async (id: string) => !!(await db.from("ticket_orders").update({ location_sent_at: new Date().toISOString() }).eq("id", id).is("location_sent_at", null).select("id").maybeSingle()).data,
    unclaim: async (id: string) => { await db.from("ticket_orders").update({ location_sent_at: null }).eq("id", id); },
    send: sendOne,
    done: async (id: string) => { await db.from("events").update({ reveal_sent_at: new Date().toISOString() }).eq("id", id).is("reveal_sent_at", null).neq("slug", TOFTU_SLUG).neq("id", TOFTU_ID); },
  }, now);
  console.log("reveal", res);
  return json(res);
});
