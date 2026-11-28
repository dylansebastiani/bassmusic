// Email copy lives here. Dylan edits text; the shape stays. One link per email where possible.
import { CONFIG, SITE_URL, fill } from "./config.ts";

export interface Member {
  id: string; email: string; first_name: string | null; access_token: string; unsubscribe_token: string;
  referral_code: string | null; confirmed_referrals: number;
}
export interface Rendered { subject: string; html: string; text: string; }

const M = CONFIG.membershipName, L = CONFIG.labelName || M;
const hi = (m: Member) => (m.first_name ? `hey ${m.first_name}` : "hey");
const FN = (Deno.env.get("SUPABASE_URL") || "https://hxfuelulxsituzcgsvhg.supabase.co") + "/functions/v1";
const confirmUrl = (m: Member) => `${FN}/confirm?t=${m.access_token}`;
const refUrl = (m: Member) => `${SITE_URL}/?r=${m.referral_code}`;
const meUrl = (m: Member) => `${SITE_URL}/collection.html?t=${m.access_token}`;
export const unsubUrl = (m: Member) => `${FN}/unsubscribe?u=${m.unsubscribe_token}`;

// One-time sign-in codes. sendNow and the runner skip List-Unsubscribe on these.
// A queued row is stored as "signin:<time>", so that form counts too.
// promoter_invite is a setup email and stays on the newsletter path.
export const isLoginCode = (key: string) => key === "signin" || key.startsWith("signin:");

// Black, one column, logo on top, one button. Tables + inline styles so Gmail,
// Apple Mail and Outlook all draw it the same; bgcolor keeps it black in light mode.
// preheader = the grey line inbox apps show next to the subject.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
// Same rule as the privacy page, the terms page and ticket emails: a placeholder
// address is not a real one, so it stays out of the footer until Dylan has one.
function postalAddress(): string {
  const addr = (CONFIG.mailingAddress || "").trim();
  if (!addr || /TBD/i.test(addr)) return "";
  return addr;
}
function wrap(m: Member, bodyHtml: string, bodyText: string, preheader = "", why = `You're getting this because you joined ${M}.`): Omit<Rendered, "subject"> {
  const addr = postalAddress();
  const foot = addr ? `${L} · ${addr}` : L;
  return {
    html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:#000" bgcolor="#000000">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#000">${preheader}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000"><tr><td align="center" style="padding:36px 16px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;color:#e9e9e9;font:16px/1.6 ${FONT}">
<tr><td align="center" style="padding-bottom:28px"><img src="${SITE_URL}/assets/mail-logo.png" width="40" height="40" alt="${L}" style="display:block;border:0"></td></tr>
<tr><td style="padding-bottom:32px">${bodyHtml}</td></tr>
<tr><td style="padding-top:36px;border-top:1px solid #222;font-size:12px;line-height:1.7;color:#777">${why}<br>
<a href="${unsubUrl(m)}" style="color:#999">Unsubscribe</a> · ${foot}</td></tr>
</table></td></tr></table></body></html>`,
    text: `${bodyText}\n\n--\n${why}\nUnsubscribe: ${unsubUrl(m)}\n${foot}`,
  };
}
const btn = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0"><tr><td bgcolor="#ffffff" style="background:#fff">
<a href="${href}" style="display:inline-block;padding:17px 30px;color:#000;text-decoration:none;font:800 13px/1 ${FONT};letter-spacing:.18em;text-transform:uppercase">${label}</a></td></tr></table>`;
const big = (t: string) => `<h1 style="margin:0 0 14px;font:900 34px/1.1 ${FONT};letter-spacing:-.01em;color:#fff;text-transform:uppercase">${t}</h1>`;
const eyebrow = (t: string) => `<div style="font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:#888;margin-bottom:12px">${t}</div>`;

// The current free track, for the welcome email. Cover art is public (site/assets/drops/<slug>.jpg);
// the audio itself stays private behind the member page.
export interface DropInfo { slug: string; title: string; artist: string | null; artwork_url?: string | null; description?: string | null; }
const coverUrl = (d: DropInfo) => d.artwork_url || `${SITE_URL}/assets/drops/${d.slug}.jpg`;

type Tpl = (m: Member, extra?: Record<string, unknown>) => Rendered;

export const TEMPLATES: Record<string, Tpl> = {
  // 1. Immediate. The play button goes through /confirm, which confirms the
  // email (and credits whoever referred them) on the way to the track.
  welcome: (m, extra) => {
    const d = extra?.drop as DropInfo | undefined;
    const play = confirmUrl(m);
    const track = d ? `${d.title}${d.artist ? " by " + d.artist : ""}` : "";
    const cover = d ? `<a href="${play}" style="display:block;text-decoration:none"><img src="${coverUrl(d)}" width="480" alt="${track}" style="display:block;width:100%;max-width:480px;height:auto;border:1px solid #222"></a>
<div style="margin-top:16px;font:900 20px/1.2 ${FONT};letter-spacing:.04em;text-transform:uppercase;color:#fff">${d.title}</div>
<div style="font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#888;margin-top:4px">${d.artist || ""}</div>${d.description ? `
<div style="font-size:14px;color:#bdbdbd;margin-top:8px">${d.description}</div>` : ""}` : "";
    const html = `${eyebrow(M)}${big("You're in.")}
<p style="margin:0 0 26px;color:#bdbdbd">${d ? "Your first unreleased track is waiting. Nobody outside this list has it." : "You're on the list. Unreleased tracks and show news land here first."}</p>
${cover}
${btn(play, d ? "&#9654;&nbsp; Play it now" : "Open my page")}
<p style="margin:0 0 8px;color:#bdbdbd">Next up: more unreleased tracks, and first word on shows.</p>
${m.referral_code ? `<p style="margin:26px 0 0;padding:18px;border:1px dashed #333;font-size:14px;color:#bdbdbd">Know someone who'd want in? Your link:<br><a href="${refUrl(m)}" style="color:#fff;word-break:break-all">${refUrl(m)}</a></p>` : ""}
<p style="margin:26px 0 0;color:#bdbdbd">See you down there.<br>Dylan</p>`;
    const text = `You're in.\n\n${d ? `Your first unreleased track is waiting: ${track}${d.description ? " (" + d.description + ")" : ""}. Nobody outside this list has it.\n\nPlay it now: ${play}` : `You're on the list. Open your page: ${play}`}\n\nNext up: more unreleased tracks, and first word on shows.\n${m.referral_code ? `\nKnow someone who'd want in? Your link: ${refUrl(m)}\n` : ""}\nSee you down there.\nDylan`;
    return { subject: d ? `you're in. ${d.title.toLowerCase()} is waiting` : `you're in`, ...wrap(m, html, text, d ? `${track}. Unreleased. Play it or grab the WAV.` : "Unreleased tracks land here first.") };
  },
  // +2 days, only if the track is still locked (no name, phone or ZIP yet). The runner
  // drops it for anyone who has unlocked by then.
  nudge: (m, extra) => {
    const d = extra?.drop as DropInfo | undefined;
    const u = meUrl(m);
    const art = d ? `<a href="${u}" style="display:block;text-decoration:none"><img src="${coverUrl(d)}" width="480" alt="${d.title}" style="display:block;width:100%;max-width:480px;height:auto;border:1px solid #222;opacity:.55"></a>` : "";
    const name = d ? d.title : "your track";
    const html = `${eyebrow(M)}${big("Still locked.")}
<p style="margin:0 0 26px;color:#bdbdbd">${d ? `${d.title}${d.artist ? " by " + d.artist : ""}` : "Your unreleased track"} is sitting on your page, waiting. Add your name, number and ZIP and it's yours: play it or grab the WAV.</p>
${art}
${btn(u, "Unlock it")}
<p style="margin:0;color:#bdbdbd">Tap in now.</p>`;
    const text = `Still locked.\n\n${name} is sitting on your page, waiting. Add your name, number and ZIP and it's yours: play it or grab the WAV.\n\nUnlock it: ${u}`;
    return { subject: `${name.toLowerCase()} is still locked`, ...wrap(m, html, text, "Tap in now. Play it or grab the WAV.") };
  },
  // 2. +2 days
  story: (m) => {
    const html = `<p>${hi(m)},</p><p>quick one on why ${L} exists.</p>
<p>Bass music needed a home around here again. Rooms that feel safe, sound that actually hits, and a crew that puts the community before the headcount. That's the whole idea. ${M} is how we keep the people who care close.</p>
<p>Want us in your city? Make sure your ZIP is on your page. It's how we figure out where to book next.</p>${btn(meUrl(m), "Open my page")}<p>— Dylan</p>`;
    const text = `${hi(m)},\n\nquick one on why ${L} exists.\n\nBass music needed a home around here again. Rooms that feel safe, sound that actually hits, and a crew that puts the community before the headcount. ${M} is how we keep the people who care close.\n\nWant us in your city? Make sure your ZIP is on your page: ${meUrl(m)}\n\n— Dylan`;
    return { subject: "why we started this", ...wrap(m, html, text) };
  },
  // 3. +4 days
  vote: (m) => {
    const a = `${SITE_URL}/collection.html?vote=a&t=${m.access_token}`, b = `${SITE_URL}/collection.html?vote=b&t=${m.access_token}`;
    const html = `<p>${hi(m)},</p><p>two tracks are fighting for the next drop. You decide.</p>
${btn(a, "Option A")}${btn(b, "Option B")}<p>One tap counts your vote. Results go to members first.</p><p>— Dylan</p>`;
    const text = `${hi(m)},\n\ntwo tracks are fighting for the next drop. You decide.\n\nOption A: ${a}\nOption B: ${b}\n\n— Dylan`;
    return { subject: "you pick what drops next", ...wrap(m, html, text) };
  },
  // 4. +7 days
  studio: (m) => {
    const html = `<p>${hi(m)},</p><p>a bit from the studio this week. Rough, unmixed, not for anyone outside this list.</p>${btn(meUrl(m), "Hear it")}<p>— Dylan</p>`;
    const text = `${hi(m)},\n\na bit from the studio this week. Rough, unmixed, not for anyone outside this list.\n${meUrl(m)}\n\n— Dylan`;
    return { subject: "from the studio", ...wrap(m, html, text) };
  },
  // 5. +10 days
  firstlook: (m) => {
    const html = `<p>${hi(m)},</p><p>members see the next show and the next drop before it's posted anywhere. Here's the first look.</p>${btn(meUrl(m), "First look")}
<p style="color:#bbb">Bring a friend in and you're first in line for guest list: <a href="${refUrl(m)}" style="color:#fff">${refUrl(m)}</a></p><p>— Dylan</p>`;
    const text = `${hi(m)},\n\nmembers see the next show and the next drop before it's posted anywhere.\n${meUrl(m)}\n\nBring a friend in: ${refUrl(m)}\n\n— Dylan`;
    return { subject: "first look: next show / drop", ...wrap(m, html, text) };
  },
  // 6. +14 days
  birthday: (m) => {
    const u = `${SITE_URL}/collection.html?t=${m.access_token}#birthday`;
    const html = `<p>${hi(m)},</p><p>we want to send you something on your birthday. Drop the date on your member page and it's handled. It also sorts out age checks for 18+ and 21+ shows.</p>${btn(u, "Add my birthday")}<p>— Dylan</p>`;
    const text = `${hi(m)},\n\nwe want to send you something on your birthday. Add the date here:\n${u}\n\n— Dylan`;
    return { subject: "we want to send you something on your birthday", ...wrap(m, html, text) };
  },
  // 7. +21 days
  featured: (m) => {
    const u = `${SITE_URL}/collection.html?t=${m.access_token}#ig`;
    const html = `<p>${hi(m)},</p><p>we repost members at shows and in drops. Want in? Add your Instagram handle and we'll find you in the crowd.</p>${btn(u, "Add my Instagram")}<p>— Dylan</p>`;
    const text = `${hi(m)},\n\nwe repost members at shows and in drops. Add your Instagram handle here:\n${u}\n\n— Dylan`;
    return { subject: "want to get featured?", ...wrap(m, html, text) };
  },
  // Sign-in: someone typed this email on a phone we don't know yet. The code goes in the
  // subject too, so phones offer it above the keyboard. The link is the backup.
  // Kept off wrap() on purpose. The logo, unsubscribe line, "you joined" line,
  // mailing address and hidden preheader are what file this under Promotions.
  signin: (m, extra) => {
    const raw = extra?.code == null ? "" : String(extra.code).trim();
    const code = /^\d{4,8}$/.test(raw) ? raw : "";
    const u = meUrl(m) + (extra?.rejoin ? "&rejoin=1" : "");
    const F = "font-family:Arial,Helvetica,sans-serif";
    const subject = code ? `Your sign-in code: ${code}` : "Your sign-in link";
    const lead = code
      ? "Type this code on the site. It works for 10 minutes."
      : "Tap the button to sign in on this device. It works for 10 minutes.";
    const codeRow = code
      ? `<tr><td style="padding:16px 24px 0;font-family:Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:8px;color:#f4f1ee;text-align:center">${code}</td></tr>`
      : "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Sign in</title></head>
<body style="margin:0;background:#0a0a0a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111110;border:1px solid #2b2927">
<tr><td style="padding:28px 24px 0;${F};font-size:26px;line-height:1.15;font-weight:bold;color:#f4f1ee">${code ? "Your sign-in code" : "Tap to sign in"}</td></tr>
<tr><td style="padding:12px 24px 0;${F};font-size:15px;line-height:1.6;color:#d9d5cf">${lead}</td></tr>
${codeRow}
<tr><td style="padding:22px 24px 0"><a href="${u}" style="display:block;background:#b6ff00;color:#000;${F};font-size:16px;font-weight:bold;text-align:center;text-decoration:none;padding:16px 12px;text-transform:uppercase;letter-spacing:1px">${code ? "Sign in with this link" : "Sign me in"}</a></td></tr>
<tr><td style="padding:18px 24px 26px;${F};font-size:12px;line-height:1.6;color:#6f6b66">Didn't ask for this? Ignore it and nothing changes.</td></tr>
</table></td></tr></table></body></html>`;
    const text = code
      ? `Your sign-in code: ${code}\n\nType this code on the site. It works for 10 minutes.\n\nSign in with this link: ${u}\n\nDidn't ask for this? Ignore it and nothing changes.`
      : `Tap the button to sign in on this device:\n${u}\n\nIt works for 10 minutes. Didn't ask for this? Ignore it and nothing changes.`;
    return { subject, html, text };
  },
  // A promoter Dylan just added: one button signs them straight in to their checklist.
  // The link carries a one-time invite code (no email), good for 7 days.
  promoter_invite: (m, extra) => {
    const link = String(extra?.link || `${SITE_URL}/promoter`), crew = String(extra?.company || "your crew");
    const html = `${eyebrow("Subduction")}${big("Let's get your show up")}
<p>You're set up on Subduction as <b>${crew}</b>. Tap below to start. No password, no app.</p>
<p style="color:#bdbdbd">It takes about 10 minutes: your logo and colors, five quick questions about your show, your flyers, and connecting where your ticket money goes. We build the page.</p>
${btn(link, "Start now")}<p style="margin:0;color:#888;font-size:14px">The button works for 7 days. After that, sign in at ${SITE_URL.replace(/^https?:\/\//, "")}/promoter with this email.</p>`;
    const text = `You're set up on Subduction as ${crew}.\n\nStart here (no password): ${link}\n\nIt takes about 10 minutes: logo and colors, five quick questions, your flyers, and where ticket money goes. We build the page.\n\nThe link works for 7 days. After that, sign in at ${SITE_URL}/promoter with this email.`;
    return { subject: `${crew} is set up on Subduction`, ...wrap(m, html, text, "Tap to start. Takes about 10 minutes.", "You're getting this because you were added as a promoter on Subduction.") };
  },
  // Referral rewards
  reward: (m, extra) => {
    const label = String(extra?.label || "a reward");
    const html = `<p>${hi(m)},</p><p>you got people in. That unlocks: <b>${label}</b>.</p><p>We'll email you the details. Thank you for actually bringing people. That's the whole thing.</p><p>— Dylan</p>`;
    const text = `${hi(m)},\n\nyou got people in. That unlocks: ${label}.\n\nWe'll email you the details.\n\n— Dylan`;
    return { subject: `you unlocked: ${label.toLowerCase()}`, ...wrap(m, html, text) };
  },
};

// The welcome sequence, in days after signup. Phase 1 enqueues only welcome;
// Phase 3 enqueues the rest from here.
export const SEQUENCE: Array<{ key: string; days: number }> = [
  { key: "welcome", days: 0 }, { key: "story", days: 2 }, { key: "vote", days: 4 }, { key: "studio", days: 7 },
  { key: "firstlook", days: 10 }, { key: "birthday", days: 14 }, { key: "featured", days: 21 },
];
export const render = (key: string, m: Member, extra?: Record<string, unknown>): Rendered | null =>
  TEMPLATES[key] ? TEMPLATES[key](m, extra) : null;
export { fill };

// Promoter sign-in from the Sell tickets page: one button, straight into the promoter app. No code to type.
// Same look as the demo's sign-in email. Kept off wrap() and out of TEMPLATES on purpose: it is sent once,
// right away, never queued, so the email runner can't resend it without its link.
export function promoterSignin(link: string): Rendered {
  const F = "font-family:Arial,Helvetica,sans-serif";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Sign in to Subduction</title></head>
<body style="margin:0;background:#0a0a0a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111110;border:1px solid #2b2927">
<tr><td style="padding:28px 24px 0;${F};font-size:26px;line-height:1.15;font-weight:bold;color:#f4f1ee">Tap to open your show</td></tr>
<tr><td style="padding:12px 24px 0;${F};font-size:15px;line-height:1.6;color:#d9d5cf">This button signs you in to your promoter account on this device. No code, no password.</td></tr>
<tr><td style="padding:22px 24px 0"><a href="${link}" style="display:block;background:#b6ff00;color:#000;${F};font-size:16px;font-weight:bold;text-align:center;text-decoration:none;padding:16px 12px;text-transform:uppercase;letter-spacing:1px">Open my show</a></td></tr>
<tr><td style="padding:18px 24px 26px;${F};font-size:12px;line-height:1.6;color:#6f6b66">Works once, for 20 minutes. Didn't ask for this? Ignore it and nothing changes.</td></tr>
</table></td></tr></table></body></html>`;
  const text = ["Tap to open your Subduction promoter account:", link, "", "Works once, for 20 minutes. Didn't ask for this? Ignore it and nothing changes."].join("\n");
  return { subject: "Your Subduction sign-in button", html, text };
}
