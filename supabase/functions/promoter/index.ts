import { db, setting } from "../_shared/db.ts";
import { json, preflight, EMAIL_RE, clean, ipHash, UUID_RE, sha256, clientIp, verifyTurnstile } from "../_shared/util.ts";
import { sendSignin, MEMBER_COLS, codeHash, type SigninMember } from "../_shared/signin.ts";
import { guessesLocked, noteGuessFail, codeEmailAllowed, noteCodeEmail } from "../_shared/signin_guard.ts";
import { isAdminEmail, newSession } from "../_shared/admin.ts";
import { staffAuth, canSee, canManage, loadCompany } from "../_shared/company.ts";
import { isLimitedSession } from "../_shared/session_trust.mjs";
import { cleanBrand, cleanKit, buildDraft } from "../_shared/kits.ts";
import { sendNow } from "../_shared/sendnow.ts";
import { brevo } from "../_shared/email/brevo.ts";
import { SITE_URL } from "../_shared/config.ts";
import { referralCards, settleReferralCredit } from "../_shared/referrals.ts";
import { handsOff, saveStreetLink, streetView } from "../_shared/street.ts";
import { audience, cleanCrowd, postalAddress, sendCrowd, MAX_RECIPIENTS } from "../_shared/crowd.ts";
import { paidSales } from "../_shared/paid_sales.ts";
import { canSeeSalesInPromoter } from "../_shared/sales_access.mjs";

// Everything a promoter does, kept to: sign in, upload brand kit, answer the show questions, upload the
// event kit, submit. Dylan (platform staff) can do all of it for any company, plus add companies.
//   POST {a:"lead", email}                                public: save a new promoter email, sync it to Brevo, tell Dylan
//   POST {a:"login", email} / {a:"verify", email, code}   email + 6-digit code; company staff (or Dylan) only
//   GET  ?a=me                                            my companies (brand kit), their shows and checklists
//   POST {a:"company-create", name, owner_email}          Dylan only: add a promoter company and its owner
//   POST {a:"invite", company, email?}                    Dylan only: email them a one-tap link to start (adds them as owner)
//   POST {a:"redeem", invite}                             the one-tap link from that email -> a session
//   POST {a:"brand-save", company, brand}                 brand kit (files + 3 colours + socials)
//   POST {a:"upload-url", company, kind, ext, show?}      one-time link to upload one kit file
//   POST {a:"show-save", company, show}                   the five questions (create or edit while not yet approved)
//   POST {a:"kit-save", show, kit}                        event kit
//   POST {a:"submit", show}                               ready for Dylan: builds the first page draft if none exists,
//                                                         then one email to Dylan and one to the promoter
//   POST {a:"referral-settle", credit}                    Dylan only: mark a referral credit paid. Sends no money.
//   GET  ?a=street&show=                                  named links for one show, with tickets and revenue
//   POST {a:"street-save", show, label, code?, payout?}   add or update a link. A payout is what the promoter owes.
//   POST {a:"crowd-count", show}                          how many of this show's paid, still-subscribed buyers. A number only. Sends nothing.
//   POST {a:"crowd-send", show, subject, body, next_date?} the Send button on the review screen. One send per company per day.
const CORS_P = { "Access-Control-Allow-Headers": "content-type, x-admin-token" };
const CONTACT = "hello@subduction.art";
// Marks the placeholder subscriber row `open` saves before the inbox is proven. provision() reactivates only these.
const OPEN_SOURCE = "promoter-open";
const HOSTS = (() => { try { return [new URL(Deno.env.get("SUPABASE_URL") || "").host]; } catch { return []; } })();
const TZ = "America/Chicago";   // show times are entered as local Central time for now
// Live show. show-save returns before any write when the show is this one.
const UNDERGROUND_EVENT_ID = "63b511f3-d838-404f-9c2e-5d4b98fbf013";
const KINDS = ["logo", "partners", "figure", "hero", "hero_small", "flyer", "icon", "subtitle", "video", "share"];
const EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4" };
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function referralCode(v: unknown): string | null {
  const s = (clean(v, 16) || "").toLowerCase();
  return /^[a-z0-9]{8}$/.test(s) ? s : null;
}
// Link the new crew to whoever's code they used. Missing migration or a bad code must not block signup.
async function attachReferral(companyId: string, email: string) {
  const { error } = await db.rpc("attach_promoter_referral", { p_company: companyId, p_email: email || null, p_code: null });
  if (error) console.error("promoter: referral", error.message);
}
// Keep the site name and the path. Drop the query, so a referrer can't carry an email or a token into the row.
function safeRef(v: unknown): string | null {
  const s = clean(v, 300);
  if (!s || !/^https?:\/\//i.test(s)) return null;
  try { const u = new URL(s); return (u.origin + u.pathname).slice(0, 200); } catch { return null; }
}
// true = this address is on an artist pass or a duo/group slot. null = we could not check, so send nothing.
async function artistContact(email: string): Promise<boolean | null> {
  const same = (e: string | null) => String(e || "").trim().toLowerCase() === email;
  const [a, m] = await Promise.all([
    db.from("artist_invites").select("email").ilike("email", email).limit(8),
    db.from("artist_members").select("email").ilike("email", email).limit(8),
  ]);
  if (a.error || m.error) return null;
  return (a.data || []).some((r) => same(r.email)) || (m.data || []).some((r) => same(r.email));
}
// Same contact write crm-sync does, for a promoter who is not an artist. A buyer keeps that label.
// If the list isn't ready yet, crm-sync retries. Never call this with an artist address.
async function syncLead(email: string, source: string): Promise<boolean> {
  const key = Deno.env.get("BREVO_API_KEY");
  const listId = await setting<number | null>("brevo_all_list_id", null);
  if (!key || !listId) return false;
  const { data: orders } = await db.from("ticket_orders").select("email").ilike("email", email).in("status", ["paid", "comp"]).limit(5);
  const buyer = (orders || []).some((r) => String(r.email || "").trim().toLowerCase() === email);
  const body: Record<string, unknown> = { email, updateEnabled: true, listIds: [listId] };
  if (!buyer) body.attributes = { ROLE: "Promoter", SOURCE: source };
  const r = await fetch("https://api.brevo.com/v3/contacts", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return !!r && (r.ok || r.status === 204);
}
// The same Brevo send the promoter invite uses. Straight to Dylan, not through the email runner.
// The person who typed the address is never a recipient, and neither is any artist contact.
async function tellDylan(email: string, info: { source: string; utm_medium: string | null; utm_campaign: string | null; referrer: string | null; referral: string | null }) {
  try {
    const list = ((await setting<string[]>("admin_emails", [])) || []).map((e) => String(e).toLowerCase()).filter((e) => EMAIL_RE.test(e) && e !== email);
    const to: string[] = [];
    for (const addr of list) { const artist = await artistContact(addr); if (artist === false) to.push(addr); }
    if (!to.length) return;
    const lines = ["New promoter signup", "", "Email: " + email, "Source: " + info.source];
    if (info.utm_medium) lines.push("Medium: " + info.utm_medium);
    if (info.utm_campaign) lines.push("Campaign: " + info.utm_campaign);
    if (info.referrer) lines.push("Referrer: " + info.referrer);
    if (info.referral) lines.push("Referral code: " + info.referral);
    lines.push("", "They typed it at " + SITE_URL + "/promoter");
    const addr = String(await setting("mailing_address", ""));
    if (addr && !/TBD/i.test(addr)) lines.push("", "Subduction", addr);
    const text = lines.join("\n"), html = "<pre style=\"font:15px/1.6 Arial,sans-serif\">" + esc(text) + "</pre>";
    for (const one of to) {
      const res = await brevo.send({ to: { email: one }, subject: "New promoter signup", html, text, tags: ["promoter-lead"], fromName: "Subduction leads" });
      if (!res.ok) console.error("promoter: lead email failed", res.status, res.error);
    }
  } catch (e) { console.error("promoter: lead email failed", (e as Error).message); }
}
// One sign-in code email: at most 10 a day per address, and a new code cancels every older live one (sendSignin does that).
async function mailCode(m: SigninMember) {
  if (!(await codeEmailAllowed(m.id))) return;
  const r = await sendSignin(m);
  if (r !== "recent") await noteCodeEmail(m.id);
}
const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(16).padStart(2, "0")).join("");

// "2027-01-08" + "18:00" in Central time -> an exact moment, daylight saving included.
function local(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const guess = new Date(`${date}T${time}:00Z`);
  const off = (d: Date) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value || "GMT";
    const m = p.match(/GMT([+-])(\d{2}):(\d{2})/); return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0; };
  return new Date(guess.getTime() - off(guess) * 60000);
}
const label = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(d).replace(",", "");
const line = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
const escMail = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const showDate = (iso: unknown) => {
  if (typeof iso !== "string" || !iso) return "Date not set";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date not set";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
};
// T.O.F.T.U. sells on the original account. This mail path never runs for it.
const handsOffShow = (slug: string, companySlug: string, legacy: boolean) =>
  slug === "underground" || companySlug === "quantum" || legacy === true;

// Same inboxes as the "New promoter account" lead alert.
async function leadInboxes(): Promise<string[]> {
  const raw = await setting<unknown>("admin_emails", []);
  const out: string[] = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    const email = String(e).toLowerCase().trim();
    if (EMAIL_RE.test(email) && !out.includes(email)) out.push(email);
  }
  return out;
}

// One Brevo call, the same shape as the demo lead alerts. Nothing is written to email_queue,
// so the daily runner never picks these up and cannot retry them.
async function sendOnce(p: { to: string[]; subject: string; text: string; html: string; replyTo?: string; fromName: string; tag: string }) {
  const key = Deno.env.get("BREVO_API_KEY");
  const to = p.to.filter((e) => EMAIL_RE.test(e));
  if (!key || !to.length) { console.error("promoter: mail skipped", !key ? "BREVO_API_KEY not set" : "no recipient"); return; }
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: p.fromName, email: Deno.env.get("FROM_EMAIL") || CONTACT },
        replyTo: p.replyTo && EMAIL_RE.test(p.replyTo) ? { email: p.replyTo } : undefined,
        to: to.map((email) => ({ email })),
        subject: p.subject.slice(0, 140),
        textContent: p.text,
        htmlContent: p.html,
        tags: [p.tag],
      }),
    });
    if (!r.ok) console.error("promoter: mail failed", r.status, (await r.text().catch(() => "")).slice(0, 200));
  } catch (e) { console.error("promoter: mail failed", (e as Error).message); }
}

// Dylan gets the show, the promoter, the date and a studio link. The promoter gets a short note
// that the show is in. Artists on the lineup are not recipients and are not read here.
async function tellShowSent(show: { slug: string; name: string; starts_at?: string | null }, co: { slug: string; name: string; legacy_stripe: boolean }, promoterEmail: string) {
  if (handsOffShow(show.slug, co.slug, co.legacy_stripe)) return;
  const name = line(show.name).slice(0, 100) || "Untitled show";
  const promoter = line(co.name).slice(0, 80) || "Promoter";
  const who = line(promoterEmail).toLowerCase();
  const when = showDate(show.starts_at);
  const studio = `${SITE_URL}/studio?e=${encodeURIComponent(show.slug)}`;
  const dylanText = [`Show sent: ${name}`, "", `Show: ${name}`, `Promoter: ${promoter}`, `Email: ${who}`, `Date: ${when}`, "", `Studio: ${studio}`].join("\n");
  let dylan: string[] = [];
  try { dylan = await leadInboxes(); } catch (e) { console.error("promoter: mail skipped", (e as Error).message); }
  await sendOnce({
    to: dylan,
    subject: `Show sent: ${name}`,
    text: dylanText,
    html: `<pre style="font:15px/1.6 Arial,sans-serif">${escMail(dylanText)}</pre>`,
    replyTo: who,
    fromName: "Subduction leads",
    tag: "lead",
  });
  if (!EMAIL_RE.test(who)) return;
  const ticketLink = `${SITE_URL}/${encodeURIComponent(show.slug)}`;
  const next = "We build your page, usually within a day, and email you a preview.";
  const confirmText = [`${name} is in. Subduction is finishing it.`, "", `Date: ${when}`, `Your ticket link: ${ticketLink}`, "", `What happens next: ${next}`].join("\n");
  const F = "font-family:Arial,Helvetica,sans-serif";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escMail(name)} is in</title></head>
<body style="margin:0;background:#0a0a0a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111110;border:1px solid #2b2927">
<tr><td style="padding:28px 24px 0;${F};font-size:26px;line-height:1.15;font-weight:bold;color:#f4f1ee">${escMail(name)} is in</td></tr>
<tr><td style="padding:12px 24px 0;${F};font-size:15px;line-height:1.6;color:#d9d5cf">Subduction is finishing it.</td></tr>
<tr><td style="padding:12px 24px 0;${F};font-size:14px;line-height:1.6;color:#9a958f">Date: ${escMail(when)}</td></tr>
<tr><td style="padding:12px 24px 0;${F};font-size:14px;line-height:1.6;color:#9a958f">Your ticket link: <a href="${escMail(ticketLink)}" style="color:#f4f1ee">${escMail(ticketLink)}</a></td></tr>
<tr><td style="padding:16px 24px 26px;${F};font-size:15px;line-height:1.6;color:#d9d5cf">What happens next: ${escMail(next)}</td></tr>
</table></td></tr></table></body></html>`;
  await sendOnce({ to: [who], subject: `${name} is in`, text: confirmText, html, fromName: "Subduction", tag: "show-sent" });
}

// Invite: a one-time code stored hashed in signin_codes (7 days), emailed as a link. The link holds
// "<row id>.<secret>" in the #fragment, so it never reaches a server log and holds no email.
async function sendInvite(subscriberId: string, company: string): Promise<boolean> {
  const { data: m } = await db.from("subscribers").select(MEMBER_COLS).eq("id", subscriberId).maybeSingle();
  if (!m || m.status === "deleted") return false;
  const secret = rand() + rand() + rand();
  const { data: inv } = await db.from("signin_codes").insert({ subscriber_id: m.id, code_hash: await codeHash(m.id, secret), expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }).select("id").single();
  if (!inv) return false;
  const { data: row } = await db.from("email_queue").insert({ subscriber_id: m.id, template_key: "promoter_invite:" + Date.now(), priority: 0, send_after: new Date(Date.now() + 15 * 60000).toISOString() }).select("id").single();
  if (!row) return false;
  return await sendNow(m as any, row.id, "promoter_invite", { link: `${SITE_URL}/promoter#invite=${inv.id}.${secret}`, company });
}
async function ownerFor(companyId: string, email: string): Promise<string | null> {
  let { data: m } = await db.from("subscribers").select("id").eq("email", email).maybeSingle();
  if (!m) m = (await db.from("subscribers").insert({ email, source: "promoter" }).select("id").single()).data;
  if (!m) return null;
  await db.from("company_staff").upsert({ company_id: companyId, subscriber_id: m.id, role: "owner" }, { onConflict: "company_id,subscriber_id", ignoreDuplicates: true });
  await db.from("companies").update({ contact_email: email }).eq("id", companyId).is("contact_email", null);
  await attachReferral(companyId, email);
  return m.id;
}

// Runs only after the person has proved the inbox: a good code or a live session. A lead that has no crew
// yet gets its company, owner row and Brevo contact now, and Dylan gets his alert now. Not before.
// `referral` comes only from the person's own proven sign-in (code, emailed link or live session), never from
// the public lead/open forms. Only the first one sticks.
async function provision(subscriberId: string, email: string, referral?: unknown): Promise<boolean> {
  email = email.toLowerCase();
  const { count } = await db.from("company_staff").select("id", { count: "exact", head: true }).eq("subscriber_id", subscriberId);
  if ((count ?? 0) > 0) return false;
  const { data: lead } = await db.from("promoter_leads").select("*").eq("email", email).maybeSingle();
  if (!lead) return false;
  if (await isAdminEmail(email)) return false;
  const artist = await artistContact(email);
  if (artist !== false) return false;
  const ref = referralCode(referral);
  if (ref && !lead.referral_code) {
    const { error: re } = await db.from("promoter_leads").update({ referral_code: ref }).eq("id", lead.id).is("referral_code", null);
    if (!re) lead.referral_code = ref;
  }
  // The bare subscriber row from `open` was saved unsubscribed (source "promoter-open"). The inbox is proven now, so turn it on.
  // Only those rows: someone who really unsubscribed keeps their choice.
  await db.from("subscribers").update({ status: "active" }).eq("id", subscriberId).eq("status", "unsubscribed").eq("source", OPEN_SOURCE);
  const local = email.split("@")[0].replace(/[^a-z0-9]+/gi, " ").trim().slice(0, 40) || "My crew";
  const name = local.replace(/\b\w/g, (ch) => ch.toUpperCase());
  const slug = slugify(name) || "crew";
  // One database call makes the company and the owner row, and only if this person has no crew yet. Two calls at
  // the same moment queue up in the database, so the second finds the first one's crew and returns null.
  const { data: coId, error } = await db.rpc("provision_promoter_company", { p_subscriber: subscriberId, p_email: email, p_name: name, p_slug: slug });
  if (error) { console.error("promoter: provision", error.message); return false; }
  if (!coId) return false;
  await attachReferral(coId as string, email);
  const source = String(lead.source || "direct");
  if (await syncLead(email, lead.utm_source || source)) await db.from("promoter_leads").update({ crm_synced_at: new Date().toISOString() }).eq("email", email);
  await tellDylan(email, { source, utm_medium: lead.utm_medium || null, utm_campaign: lead.utm_campaign || null, referrer: lead.referrer || null, referral: lead.referral_code || null });
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") { const r = preflight(req)!; return new Response(null, { status: 204, headers: { ...Object.fromEntries(r.headers), ...CORS_P } }); }
  const ok = (body: unknown) => json(body, 200, { "Cache-Control": "no-store", ...CORS_P });
  const no = (m: string, s = 400) => json({ error: m }, s, CORS_P);
  const u = new URL(req.url);
  let b: Record<string, any> = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { return no("Bad request"); } }
  const a = req.method === "GET" ? u.searchParams.get("a") || "" : String(b.a || "");

  // ---- sign in: same email + code as everyone else, for company staff (and Dylan) ----
  if (a === "login" || a === "verify") {
    const email = (clean(b.email, 254) || "").toLowerCase();
    if (!EMAIL_RE.test(email)) return no("That email doesn't look right.");
    const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, (await setting("ip_salt", "unset")) + "|promoter") });
    if ((n ?? 0) > 10) return no("Too many tries. Wait a minute.", 429);
    const { data: m } = await db.from("subscribers").select(MEMBER_COLS).eq("email", email).maybeSingle();
    const { count } = m ? await db.from("company_staff").select("id", { count: "exact", head: true }).eq("subscriber_id", m.id) : { count: 0 };
    const allowed = !!m && m.status !== "deleted" && ((count ?? 0) > 0 || await isAdminEmail(email));
    // Same answer either way, so this can't be used to find out who's a promoter.
    if (!allowed) return a === "login" ? ok({ code_sent: true }) : no("That code didn't match.");
    // Artist pass mail is sent on its own. This screen never emails an artist contact.
    if (a === "login" && await artistContact(email) !== false) return ok({ code_sent: true });
    if (a === "login") { await mailCode(m as SigninMember); return ok({ code_sent: true }); }
    // Wrong guesses are counted per person across all their codes, so a new code never resets the count.
    if (await guessesLocked(m!.id)) return no("Too many wrong codes today. Try again tomorrow.", 429);
    const code = (clean(b.code, 12) || "").replace(/\D/g, "");
    const { data: c } = await db.from("signin_codes").select("id,code_hash,expires_at,attempts").eq("subscriber_id", m!.id).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!c || new Date(c.expires_at).getTime() < Date.now() || c.attempts >= 5) return no("That code expired. Send a new one.");
    if (c.code_hash !== await codeHash(m!.id, code)) { await db.from("signin_codes").update({ attempts: c.attempts + 1 }).eq("id", c.id); await noteGuessFail(m!.id); return no("That code didn't match."); }
    await db.from("signin_codes").update({ used_at: new Date().toISOString() }).eq("id", c.id);
    await provision(m!.id, email, b.referral_code);
    return ok({ token: await newSession(m!.id), email });
  }

  // ---- the one-tap link from the invite email ----
  if (a === "redeem") {
    const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, (await setting("ip_salt", "unset")) + "|promoter") });
    if ((n ?? 0) > 10) return no("Too many tries. Wait a minute.", 429);
    const [id, secret] = String(b.invite || "").split(".");
    const bad = () => no("That link has expired or was already used. Sign in with your email instead.");
    if (!UUID_RE.test(id || "") || !/^[0-9a-f]{36}$/.test(secret || "")) return bad();
    const { data: c } = await db.from("signin_codes").select("id,subscriber_id,code_hash,expires_at,attempts,used_at").eq("id", id).maybeSingle();
    if (!c || c.used_at || new Date(c.expires_at).getTime() < Date.now() || c.attempts >= 5) return bad();
    if (c.code_hash !== await codeHash(c.subscriber_id, secret)) { await db.from("signin_codes").update({ attempts: c.attempts + 1 }).eq("id", c.id); return bad(); }
    await db.from("signin_codes").update({ used_at: new Date().toISOString() }).eq("id", c.id);
    const { data: m } = await db.from("subscribers").select("email,status").eq("id", c.subscriber_id).maybeSingle();
    if (!m || m.status === "deleted") return bad();
    await provision(c.subscriber_id, m.email, b.referral_code);
    return ok({ token: await newSession(c.subscriber_id), email: m.email });
  }

  // A promoter email from the sign-in screen. Same answer either way, so this can't be used to find out who's already on a crew.
  if (a === "lead") {
    if (clean(b.hp_field, 200) || clean(b.website, 200) || clean(b.company, 200)) return ok({ ok: true });
    const email = (clean(b.email, 254) || "").toLowerCase();
    if (!EMAIL_RE.test(email)) return no("That email doesn't look right.");
    const salt = await setting("ip_salt", "unset");
    const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, salt + "|promoter-lead") });
    if ((n ?? 0) > 8) return no("Too many tries. Wait a minute.", 429);
    if (!(await verifyTurnstile(clean(b.turnstile, 4000), clientIp(req), clean(b.ts_err, 20)))) return no("Bot check failed. Refresh and try again.", 403);
    if (await isAdminEmail(email)) return ok({ ok: true });
    const { data: m } = await db.from("subscribers").select("id,status").eq("email", email).maybeSingle();
    if (m && m.status !== "deleted") {
      const { count } = await db.from("company_staff").select("id", { count: "exact", head: true }).eq("subscriber_id", m.id);
      if ((count ?? 0) > 0) return ok({ ok: true });
    }
    const utm_source = clean(b.utm_source, 80), utm_medium = clean(b.utm_medium, 80), utm_campaign = clean(b.utm_campaign, 80), referrer = safeRef(b.referrer);
    // No referral code here: this form is public, so anyone could stamp one on someone else's address.
    // It is read later, from the person's own sign-in (see provision).
    const referral = null;
    const source = (clean(b.source, 80) || utm_source || "direct").slice(0, 80);
    const { data: existing } = await db.from("promoter_leads").select("id").eq("email", email).maybeSingle();
    if (existing) return ok({ ok: true });
    let { error } = await db.from("promoter_leads").insert({ email, source, utm_source, utm_medium, utm_campaign, referrer, ip_hash: await ipHash(req, salt) });
    if (error && (error.code === "23505" || /duplicate key/i.test(error.message || ""))) return ok({ ok: true });
    if (error) { console.error("promoter: lead", error.message); return no("Couldn't save that. Try again.", 500); }
    const artist = await artistContact(email);
    // Confirmed artist contacts are stored here and nowhere else. No Brevo write, no email to them.
    if (artist === true) await db.from("promoter_leads").update({ crm_synced_at: new Date().toISOString() }).eq("email", email);
    else if (artist === false && await syncLead(email, utm_source || source)) await db.from("promoter_leads").update({ crm_synced_at: new Date().toISOString() }).eq("email", email);
    await tellDylan(email, { source, utm_medium, utm_campaign, referrer, referral });
    return ok({ ok: true });
  }

  // One email starts a promoter account. The answer is always the same, so it can't be used to find out
  // who is already on file. A new address is saved as a lead and sent the normal sign-in email. The
  // company, owner row, Brevo contact and alert to Dylan come only after that sign-in succeeds (provision).
  if (a === "open") {
    if (clean(b.hp_field, 200) || clean(b.website, 200) || clean(b.company, 200)) return ok({ ok: true });
    const email = (clean(b.email, 254) || "").toLowerCase();
    if (!EMAIL_RE.test(email)) return no("That email doesn't look right.");
    const salt = await setting("ip_salt", "unset");
    const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, salt + "|promoter-open") });
    if ((n ?? 0) > 8) return no("Too many tries. Wait a minute.", 429);
    if (!(await verifyTurnstile(clean(b.turnstile, 4000), clientIp(req), clean(b.ts_err, 20)))) return no("Bot check failed. Refresh and try again.", 403);
    // Everything below runs after the answer goes out, so the response time is the same for every address
    // (artist contacts, existing members and new people can't be told apart by timing).
    const utm_source = clean(b.utm_source, 80), utm_medium = clean(b.utm_medium, 80), utm_campaign = clean(b.utm_campaign, 80), referrer = safeRef(b.referrer);
    const source = (clean(b.source, 80) || utm_source || "direct").slice(0, 80);
    const ipH = await ipHash(req, salt);
    const work = (async () => {
      // Artist pass mail is sent on its own. This screen never emails an artist contact.
      if (await artistContact(email) !== false) return;
      let { data: m } = await db.from("subscribers").select("id,status").eq("email", email).maybeSingle();
      if (!m) {
        // The only record a new address leaves before it is verified. No referral code here: it comes later from
        // the person's own sign-in (see provision).
        const { error: le } = await db.from("promoter_leads").insert({ email, source, utm_source, utm_medium, utm_campaign, referrer, ip_hash: ipH });
        if (le && !(le.code === "23505" || /duplicate key/i.test(le.message || ""))) console.error("promoter: lead", le.message);
        // The sign-in code needs a subscriber row to hang on. It is saved unsubscribed (no mail, no Brevo) and turned
        // on in provision() once the inbox is proven. It has no company and no crew until then.
        m = (await db.from("subscribers").insert({ email, source: OPEN_SOURCE, status: "unsubscribed" }).select("id,status").single()).data
          || (await db.from("subscribers").select("id,status").eq("email", email).maybeSingle()).data;
      }
      if (m && m.status !== "deleted") {
        const { data: full } = await db.from("subscribers").select(MEMBER_COLS).eq("id", m.id).maybeSingle();
        if (full) await mailCode(full as SigninMember);
      }
    })().catch((e) => console.error("promoter: open", String(e?.message || e)));
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(work); else await work;
    return ok({ ok: true });
  }

  // Public page for one street-team link. Ticket count only: no money, no buyer names, and never T.O.F.T.U.
  if (req.method === "GET" && a === "link") {
    const slug = (u.searchParams.get("e") || "").toLowerCase();
    const code = (u.searchParams.get("c") || "").toLowerCase();
    if (slug === "underground" || !/^[a-z0-9-]{1,80}$/.test(slug) || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(code)) return no("Not found", 404);
    const { data: ev } = await db.from("events").select("id,slug,name,company_id,review_status").eq("slug", slug).maybeSingle();
    if (!ev || ev.review_status !== "approved" || ev.id === UNDERGROUND_EVENT_ID || ev.slug === "underground") return no("Not found", 404);
    const linkCo = await loadCompany(ev.company_id);
    if (!linkCo || handsOff(ev, linkCo)) return no("Not found", 404);
    const view = await streetView(ev, SITE_URL);
    const row = ((view.rows || []) as { code: string; label: string; tickets: number; link: string }[]).find((r) => r.code === code);
    if (!row) return no("Not found", 404);
    // Codes are guessable, so the public page gets the ticket count only. Money stays behind sign-in.
    return ok({ show: ev.name, slug: ev.slug, label: row.label, tickets: row.tickets, link: row.link });
  }

  let st = await staffAuth(req);
  if (!st) {
    // A signed-in address that asked for a promoter account but has no crew yet gets it now.
    const tk0 = (req.headers.get("x-admin-token") || "").trim();
    if (/^[0-9a-f]{64}$/.test(tk0)) {
      const { data: s0 } = await db.from("admin_sessions").select("subscriber_id,expires_at,created_at").eq("token_hash", await sha256(tk0)).maybeSingle();
      // Member-key sessions are limited and never start a promoter crew.
      if (s0 && new Date(s0.expires_at).getTime() > Date.now() && !isLimitedSession(s0.created_at, s0.expires_at)) {
        const { data: m0 } = await db.from("subscribers").select("email,status").eq("id", s0.subscriber_id).maybeSingle();
        if (m0 && m0.status !== "deleted" && await provision(s0.subscriber_id, m0.email, b.referral_code)) st = await staffAuth(req);
      }
    }
  }
  if (!st) {
    // A live sign-in with no promoter crew is not a bad sign-in. Tell the page so it keeps the session.
    const tk = (req.headers.get("x-admin-token") || "").trim();
    if (/^[0-9a-f]{64}$/.test(tk)) {
      const { data: s } = await db.from("admin_sessions").select("subscriber_id,expires_at").eq("token_hash", await sha256(tk)).maybeSingle();
      if (s && new Date(s.expires_at).getTime() > Date.now()) {
        const { data: m } = await db.from("subscribers").select("status").eq("id", s.subscriber_id).maybeSingle();
        if (m && m.status !== "deleted") return json({ error: "No promoter crew on this account yet.", no_crew: true }, 403);
      }
    }
    return no("Sign in again.", 401);
  }

  if (req.method === "GET" && a === "buyers") {
    const id = u.searchParams.get("show") || "";
    if (!UUID_RE.test(id) || id === UNDERGROUND_EVENT_ID) return no("Not found", 404);
    const { data: show } = await db.from("events").select("id,slug,name,company_id").eq("id", id).maybeSingle();
    const buyerCo = show ? await loadCompany(show.company_id) : null;
    if (!show || !buyerCo || !canManage(st, show.company_id) || handsOff(show, buyerCo) || show.slug === "underground") return no("Not found", 404);
    const { data: orders, error } = await db.from("ticket_orders").select("id,name,email,phone,status,total_cents,created_at").eq("event_id", show.id).in("status", ["paid", "comp"]).order("created_at");
    if (error) return no("Couldn't load buyers.", 500);
    const orderIds = (orders || []).map((o) => o.id);
    const { data: tix } = orderIds.length ? await db.from("tickets").select("order_id,code").in("order_id", orderIds) : { data: [] as { order_id: string; code: string }[] };
    const codes: Record<string, string[]> = {};
    for (const t of tix || []) (codes[t.order_id] ||= []).push(t.code);
    // A cell that starts with = + - @ (or a tab/return) would run as a formula in a spreadsheet. A leading ' stops that.
    const cell = (v: unknown) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const lines = ["name,email,phone,status,total,codes,when"];
    for (const o of orders || []) lines.push([cell(o.name), cell(o.email), cell(o.phone), cell(o.status), cell(((Number(o.total_cents) || 0) / 100).toFixed(2)), cell((codes[o.id] || []).join(" ")), cell(o.created_at)].join(","));
    return new Response(lines.join("\n") + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${show.slug}-buyers.csv"`, "Cache-Control": "no-store", ...CORS_P } });
  }

  // Ledger only. Dylan marks the row paid. No transfer is created.
  if (a === "referral-settle") {
    if (!st.owner) return no("Only Subduction can mark a referral credit paid.", 403);
    const res = await settleReferralCredit(String(b.credit || ""), st.id);
    if ("error" in res) return no(res.error);
    return ok({ settled: true });
  }

  if (a === "street" || a === "street-save") {
    const id = a === "street" ? (u.searchParams.get("show") || "") : String(b.show || "");
    if (!UUID_RE.test(id)) return no("Not found", 404);
    const { data: show } = await db.from("events").select("id,slug,name,company_id").eq("id", id).maybeSingle();
    const co = show ? await loadCompany(show.company_id) : null;
    if (!show || !co || !canSee(st, show.company_id)) return no("Not found", 404);
    if (a === "street-save" && !canManage(st, show.company_id)) return no("Only the company's owner can change street links.", 403);
    if (handsOff(show, co)) return no("This show can't be changed here.", 409);
    if (a === "street-save") {
      const saved = await saveStreetLink(show, { label: b.label, code: b.code, payout: b.payout }, SITE_URL);
      if ("error" in saved && saved.error) return no(String(saved.error));
      return ok(saved);
    }
    return ok(await streetView(show, SITE_URL));
  }

  if (a === "me") {
    const ids = st.owner ? null : st.companies.map((c) => c.id);
    // Promoter companies only. The original account (T.O.F.T.U.) is run from the staff page, not here.
    let cq = db.from("companies").select("id,slug,name,status,brand,stripe_charges_enabled,legacy_stripe,contact_email").eq("legacy_stripe", false).order("created_at", { ascending: false });
    if (ids) cq = cq.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const { data: cos } = await cq;
    const { data: shows } = await db.from("events").select("id,slug,name,company_id,review_status,review_note,sales_open,kit,page,page_draft,city,venue,age,location_secret,address_reveal_at,starts_at")
      .in("company_id", (cos || []).map((c) => c.id).concat(["00000000-0000-0000-0000-000000000000"])).order("created_at", { ascending: false });
    const sIds = (shows || []).map((s) => s.id).concat(["00000000-0000-0000-0000-000000000000"]);
    const sales = await paidSales(db, (shows || []).filter((s) => canSeeSalesInPromoter(canManage(st, s.company_id))).map((s) => s.id));
    const [{ data: nights }, { data: types }, referral] = await Promise.all([
      db.from("ticket_nights").select("id,event_id,slug,label,starts_at,ends_at,sort").in("event_id", sIds).order("sort"),
      db.from("ticket_types").select("id,event_id,slug,name,night_ids,tiers,on_sale,sort").in("event_id", sIds).order("sort"),
      referralCards((cos || []).map((c) => c.id), SITE_URL),
    ]);
    return ok({ email: st.email, owner: st.owner,
      companies: (cos || []).map((c) => ({ id: c.id, slug: c.slug, name: c.name, status: c.status, brand: c.brand || {}, paid_ready: c.legacy_stripe || c.stripe_charges_enabled,
        can_manage: canManage(st, c.id), referral: referral?.[c.id] || null, ...(st.owner ? { contact_email: c.contact_email } : {}) })),
      shows: (shows || []).map((s) => {
        const ns = (nights || []).filter((n) => n.event_id === s.id), ts = (types || []).filter((t) => t.event_id === s.id && t.slug !== "test" && t.slug !== "artist");
        const kit = s.kit || {};
        return { id: s.id, slug: s.slug, name: s.name, company_id: s.company_id, review_status: s.review_status, review_note: s.review_note, live: !!s.page && s.sales_open,
          city: s.city, venue: s.venue, age: s.age, secret: s.location_secret, reveal_at: s.address_reveal_at, kit,
          nights: ns.map((n) => ({ id: n.id, label: n.label, starts_at: n.starts_at, ends_at: n.ends_at })),
          tickets: ts.map((t) => ({ name: t.name, nights: t.night_ids.map((id: string) => ns.findIndex((n) => n.id === id)), tiers: t.tiers })),
          ...(canSeeSalesInPromoter(canManage(st, s.company_id)) ? { sales: sales[s.id] || { count: 0, face_cents: 0, by_price: [] } } : {}),
          checklist: { details: ns.length > 0 && ts.length > 0, art: !!(kit.flyers || []).some(Boolean) || !!kit.hero || !!kit.links, submitted: s.review_status !== "draft" } };
      }) });
  }

  if (a === "company-create") {
    if (!st.owner) return no("Only Subduction can add companies.", 403);
    const name = clean(b.name, 80) || "", email = (clean(b.owner_email, 254) || "").toLowerCase();
    // Their email is optional: Dylan can set a promoter up himself and add their email later.
    if (!name) return no("What's the crew called?");
    if (email && !EMAIL_RE.test(email)) return no("That email doesn't look right.");
    let slug = slugify(name) || "crew";
    if ((await db.from("companies").select("id").eq("slug", slug).maybeSingle()).data) slug = `${slug}-${rand().slice(0, 4)}`;
    const { data: co, error } = await db.from("companies").insert({ slug, name, status: "active", contact_email: email || null }).select("id,slug").single();
    if (error || !co) return no("Couldn't add that company.", 500);
    let invited = false;
    if (email) { const sid = await ownerFor(co.id, email); if (sid) invited = await sendInvite(sid, name); }
    return ok({ company: co, invited });
  }

  if (a === "invite") {
    if (!st.owner) return no("Only Subduction can send invites.", 403);
    const co = UUID_RE.test(String(b.company || "")) ? await loadCompany(String(b.company)) : null;
    if (!co || co.legacy_stripe) return no("Not found", 404);
    const email = (clean(b.email, 254) || co.contact_email || "").toLowerCase();
    if (!EMAIL_RE.test(email)) return no("Add their email first.");
    const sid = await ownerFor(co.id, email);
    if (!sid || !await sendInvite(sid, co.name)) return no("Couldn't send the email. Try again in a minute.", 502);
    return ok({ invited: email });
  }

  // Everything below acts on one company (directly, or through one of its shows).
  let companyId = typeof b.company === "string" && UUID_RE.test(b.company) ? b.company : "";
  let show: Record<string, any> | null = null;
  if (typeof b.show === "string" && UUID_RE.test(b.show)) {
    show = (await db.from("events").select("id,slug,name,company_id,review_status,kit,page_draft,page,location_secret,starts_at").eq("id", b.show).maybeSingle()).data;
    if (!show) return no("Not found", 404);
    companyId = show.company_id;
  }
  if (!companyId || !canSee(st, companyId)) return no("Not found", 404);
  const co = await loadCompany(companyId);
  if (!co) return no("Not found", 404);

  if (a === "brand-save") {
    if (!canManage(st, companyId)) return no("Only the company's owner can change the brand kit.", 403);
    const brand = cleanBrand(b.brand, HOSTS);
    await db.from("companies").update({ brand }).eq("id", companyId);
    return ok({ brand });
  }

  if (a === "pixel-save") {
    if (!show || show.slug === "underground" || show.id === UNDERGROUND_EVENT_ID || handsOffShow(show.slug, co.slug, !!co.legacy_stripe)) return no("This show can't be changed here.", 409);
    if (!canManage(st, companyId)) return no("Only the company's owner can change this.", 403);
    const raw = String(b.pixel || "").replace(/\D/g, "");
    if (raw && !/^\d{8,20}$/.test(raw)) return no("That pixel id should be 8 to 20 digits.");
    const kit = { ...(show.kit || {}) };
    if (raw) kit.pixel = raw; else delete kit.pixel;
    const { error } = await db.from("events").update({ kit }).eq("id", show.id);
    if (error) return no("Couldn't save that.", 500);
    return ok({ pixel: kit.pixel || null });
  }

  if (a === "upload-url") {
    const kind = KINDS.includes(b.kind) ? b.kind : "", ext = String(b.ext || "").toLowerCase();
    if (!kind || !EXT[ext]) return no("That file type isn't supported. Use JPG, PNG, WebP or MP4.");
    if ((kind === "video") !== (ext === "mp4")) return no(kind === "video" ? "Teasers need to be MP4." : "Use JPG, PNG or WebP for images.");
    const where = show ? `show-${show.id}` : "brand";
    const path = `${companyId}/${where}/${kind}-${Date.now()}-${rand()}.${ext === "jpeg" ? "jpg" : ext}`;
    const { data, error } = await db.storage.from("kits").createSignedUploadUrl(path);
    if (error || !data) return no("Couldn't start the upload. Try again.", 500);
    const { data: pub } = db.storage.from("kits").getPublicUrl(path);
    return ok({ upload_url: data.signedUrl, url: pub.publicUrl, content_type: EXT[ext] });
  }

  if (a === "show-save") {
    // No writes to the live show. Checked again before the artist-pass insert below.
    if (show && (show.slug === "underground" || show.id === UNDERGROUND_EVENT_ID)) return no("This show can't be changed here.", 409);
    if (show && !["draft", "rejected"].includes(show.review_status) && !st.owner) return no("This show is already with Subduction. Message us to change details.", 409);
    const s = (b.details || {}) as Record<string, any>;
    const name = clean(s.name, 100) || "";
    if (!name) return no("Give the show a name.");
    const nightsIn = (Array.isArray(s.nights) ? s.nights : []).slice(0, 6);
    const nights = nightsIn.map((n: any, i: number) => {
      const start = local(String(n.date || ""), String(n.doors || "")); let end = local(String(n.date || ""), String(n.ends || ""));
      if (start && end && end <= start) end = new Date(end.getTime() + 86400000);   // ends after midnight
      return start ? { slug: `n${i + 1}`, label: label(start), starts_at: start.toISOString(), ends_at: end?.toISOString() || null, sort: i + 1 } : null;
    });
    if (!nights.length || nights.some((n: unknown) => !n)) return no("Every night needs a date and a doors time.");
    const age = ["18+", "21+", "All ages"].includes(s.age) ? s.age : null;
    const secret = !!s.secret, reveal = secret && /^\d{4}-\d{2}-\d{2}$/.test(String(s.reveal_date || "")) ? local(s.reveal_date, "12:00") : null;
    const tickets = (Array.isArray(s.tickets) ? s.tickets : []).slice(0, 8).map((t: any, i: number) => ({
      slug: slugify(clean(t.name, 40) || "") || `t${i + 1}`, name: clean(t.name, 60) || "", sort: i + 1,
      nights: (Array.isArray(t.nights) ? t.nights : []).map(Number).filter((x: number) => x >= 0 && x < nights.length),
      tiers: (Array.isArray(t.tiers) ? t.tiers : []).slice(0, 6).map((r: any) => ({ name: clean(r.name, 40) || "General", price_cents: Math.round(Number(r.price) * 100), qty: Math.floor(Number(r.qty)) }))
        .filter((r: any) => r.price_cents >= 100 && r.price_cents <= 100000 && r.qty >= 1 && r.qty <= 10000),
    }));
    if (!tickets.length || tickets.some((t: any) => !t.name || !t.nights.length || !t.tiers.length)) return no("Each ticket needs a name, which night(s) it's for, and at least one price and quantity.");
    if (new Set(tickets.map((t: any) => t.slug)).size !== tickets.length) return no("Two tickets have the same name.");
    if (tickets.some((t: any) => t.slug === "artist")) return no("Artist is reserved for artist passes. Name that ticket something else.");

    const fields = { name, city: clean(s.city, 80), venue: secret ? null : clean(s.venue, 120), age, location_secret: secret, address_reveal_at: reveal?.toISOString() || null,
      starts_at: nights[0]!.starts_at, ends_at: nights[nights.length - 1]!.ends_at, company_id: companyId };
    let id = show?.id as string | undefined;
    let eventSlug = show?.slug || "";
    if (id) {
      const { count: sold } = await db.from("tickets").select("id", { count: "exact", head: true }).eq("event_id", id);
      if ((sold ?? 0) > 0) return no("Tickets have already been issued for this show, so its nights and prices can't change here.", 409);
      await db.from("events").update(fields).eq("id", id);
    }
    else {
      let slug = slugify(name) || "show";
      if ((await db.from("events").select("id").eq("slug", slug).maybeSingle()).data) slug = `${slug}-${rand().slice(0, 4)}`;
      if (slug === "underground") return no("This show can't be changed here.", 409);
      eventSlug = slug;
      const { data: ev, error } = await db.from("events").insert({ ...fields, slug, sales_open: false, review_status: "draft" }).select("id").single();
      if (error || !ev) return no("Couldn't save the show.", 500);
      id = ev.id;
    }
    // Nights and tickets are replaced wholesale. Safe: nothing can be sold before Subduction approves,
    // and shows with issued tickets were refused above.
    await db.from("ticket_types").delete().eq("event_id", id);
    await db.from("ticket_nights").delete().eq("event_id", id);
    const { data: ns } = await db.from("ticket_nights").insert(nights.map((n: any) => ({ ...n, event_id: id, lineup: [] }))).select("id,sort");
    const byIdx = (ns || []).sort((x, y) => x.sort - y.sort).map((n) => n.id);
    await db.from("ticket_types").insert(tickets.map((t: any) => ({ event_id: id, slug: t.slug, name: t.name, night_ids: t.nights.map((i: number) => byIdx[i]), tiers: t.tiers, on_sale: true, sort: t.sort,
      blurb: t.nights.length > 1 ? "All nights, one ticket" : null })));
    // Artist Pass, same shape as migration 0020. Not for sale, no prices, every night of this show.
    // Insert only. The live show is excluded above, before any write, and again here.
    if (eventSlug !== "underground" && id !== UNDERGROUND_EVENT_ID) {
      const { error: artistErr } = await db.from("ticket_types").insert({
        event_id: id, slug: "artist", name: "Artist Pass", blurb: "Artists only", night_ids: byIdx, tiers: [], on_sale: false, sort: 99,
      });
      if (artistErr) return no("Couldn't set up artist passes for this show.", 500);
    }
    return ok({ show: { id } });
  }

  if (!show) return no("Pick a show.");

  if (a === "crowd-count" || a === "crowd-send") {
    // Owner only, same as the brand kit. Other staff can see buyers but must not email them.
    if (!canManage(st, show.company_id)) return no("Only the company's owner can message the crowd.", 403);
    if (handsOff(show as any, co)) return no("This show can't be messaged from here.", 409);
    let n: Awaited<ReturnType<typeof audience>>;
    try { n = await audience(show as any); } catch (e) { console.error("promoter: crowd", (e as Error).message); return no("Couldn't count your crowd. Try again.", 500); }
    if (a === "crowd-count") return ok({ count: n.length, max: MAX_RECIPIENTS });
    const c = cleanCrowd(b);
    if ("error" in c) return no(c.error);
    if (!postalAddress()) return no("Email can't go out until Subduction adds a mailing address.", 409);
    if (!n.length) return no("Nobody to send to for this show.", 409);
    if (n.length > MAX_RECIPIENTS) return no("That crowd is over " + MAX_RECIPIENTS + " people. Message Subduction and we'll send it with you.", 409);
    // Claim today's send first. The unique key (company, day) lets only one request through.
    const { data: claim, error: ce } = await db.from("crowd_sends").insert({ company_id: companyId, event_id: show.id, sent_by: st.id, subject: c.subject, next_date: c.nextDate || null, recipients: n.length }).select("id").single();
    if (ce || !claim) {
      if (ce && (ce.code === "23505" || /duplicate key/i.test(ce.message || ""))) return no("You already messaged your crowd today. Try again tomorrow.", 429);
      console.error("promoter: crowd claim", ce?.message);
      return no("Sending isn't ready yet. Try again later.", 503);
    }
    const out = await sendCrowd(c, co.name, String(show.name || "the show"), n);
    if (out.sent === 0) await db.from("crowd_sends").delete().eq("id", claim.id);   // nothing went out, so it doesn't use up today
    else await db.from("crowd_sends").update({ sent: out.sent, status: out.stopped ? "stopped" : "sent" }).eq("id", claim.id);
    await db.from("engagement_events").insert({ subscriber_id: st.id, type: "promoter:crowd", meta: { show: show.slug, company: co.slug, sent: out.sent } });
    if (out.stopped) return ok({ sent: out.sent, total: out.total, stopped: true });
    if (out.sent === 0) return no("The email service didn't take it. Nothing was sent. Try again later.", 502);
    return ok({ sent: out.sent, total: out.total, stopped: false });
  }

  if (a === "kit-save") {
    if (!canManage(st, companyId)) return no("Only the company's owner can change the event kit.", 403);
    if (handsOffShow(String(show.slug || ""), co.slug, !!co.legacy_stripe) || show.slug === "underground" || show.id === UNDERGROUND_EVENT_ID) return no("This show can't be changed here.", 409);
    if (show.review_status === "approved") return no("This show is already approved. Message us to change it.", 409);
    const kit = cleanKit(b.kit, HOSTS);
    // The pixel id has its own save (pixel-save). The kit form doesn't carry it, so keep what's stored.
    if (show.kit?.pixel) kit.pixel = show.kit.pixel;
    await db.from("events").update({ kit }).eq("id", show.id);
    return ok({ kit });
  }

  if (a === "submit") {
    if (!canManage(st, companyId)) return no("Only the company's owner can submit a show.", 403);
    // Refuse before any write.
    if (handsOffShow(String(show.slug || ""), co.slug, !!co.legacy_stripe) || show.slug === "underground" || show.id === UNDERGROUND_EVENT_ID) return no("This show can't be changed here.", 409);
    const { count: nNights } = await db.from("ticket_nights").select("id", { count: "exact", head: true }).eq("event_id", show.id);
    if (!nNights) return no("Answer the show questions first.");
    const upd: Record<string, unknown> = { review_status: show.review_status === "approved" ? "approved" : "submitted" };
    // The first page draft, built from the brand kit + event kit, waiting in Dylan's studio.
    if (!show.page_draft && !show.page) upd.page_draft = buildDraft(cleanBrand((await db.from("companies").select("brand").eq("id", companyId).single()).data?.brand, HOSTS),
      cleanKit(show.kit, HOSTS), nNights, { secret: show.location_secret }, HOSTS);
    // Mail only the request that actually moves a show into "submitted". A second click finds the
    // row already moved and sends nothing. T.O.F.T.U. keeps the old write and gets no mail.
    const off = handsOffShow(String(show.slug || ""), co.slug, !!co.legacy_stripe);
    const fresh = show.review_status === "draft" || show.review_status === "rejected";
    let mailed = false;
    if (off || !fresh) await db.from("events").update(upd).eq("id", show.id);
    else {
      const { data: flipped, error } = await db.from("events").update(upd).eq("id", show.id).in("review_status", ["draft", "rejected"]).select("id");
      if (error) console.error("promoter: submit failed", error.message);
      mailed = !error && Array.isArray(flipped) && flipped.length > 0;
    }
    await db.from("engagement_events").insert({ subscriber_id: st.id, type: "promoter:submit", meta: { show: show.slug, company: co.slug } });
    if (mailed) { try { await tellShowSent({ slug: String(show.slug), name: String(show.name || ""), starts_at: show.starts_at }, co, st.email); } catch (e) { console.error("promoter: mail failed", (e as Error).message); } }
    return ok({ submitted: true });
  }

  return no("Bad request");
});
