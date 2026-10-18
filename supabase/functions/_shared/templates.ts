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

// Black, one column, logo on top, one button. Tables + inline styles so Gmail,
// Apple Mail and Outlook all draw it the same; bgcolor keeps it black in light mode.
// preheader = the grey line inbox apps show next to the subject.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
function wrap(m: Member, bodyHtml: string, bodyText: string, preheader = ""): Omit<Rendered, "subject"> {
  const foot = `${L} · ${CONFIG.mailingAddress}`;
  return {
    html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:#000" bgcolor="#000000">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#000">${preheader}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000"><tr><td align="center" style="padding:36px 16px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;color:#e9e9e9;font:16px/1.6 ${FONT}">
<tr><td align="center" style="padding-bottom:28px"><img src="${SITE_URL}/assets/mail-logo.png" width="40" height="40" alt="${L}" style="display:block;border:0"></td></tr>
<tr><td style="padding-bottom:32px">${bodyHtml}</td></tr>
<tr><td style="padding-top:36px;border-top:1px solid #222;font-size:12px;line-height:1.7;color:#777">You're getting this because you joined ${M}.<br>
<a href="${unsubUrl(m)}" style="color:#999">Unsubscribe</a> · ${foot}</td></tr>
</table></td></tr></table></body></html>`,
    text: `${bodyText}\n\n--\nYou're getting this because you joined ${M}.\nUnsubscribe: ${unsubUrl(m)}\n${foot}`,
  };
}
const btn = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0"><tr><td bgcolor="#ffffff" style="background:#fff">
<a href="${href}" style="display:inline-block;padding:17px 30px;color:#000;text-decoration:none;font:800 13px/1 ${FONT};letter-spacing:.18em;text-transform:uppercase">${label}</a></td></tr></table>`;
const big = (t: string) => `<h1 style="margin:0 0 14px;font:900 34px/1.1 ${FONT};letter-spacing:-.01em;color:#fff;text-transform:uppercase">${t}</h1>`;
const eyebrow = (t: string) => `<div style="font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:#888;margin-bottom:12px">${t}</div>`;

// The current free track, for the welcome email. Cover art is public (site/assets/drops/<slug>.jpg);
// the audio itself stays private behind the member page.
export interface DropInfo { slug: string; title: string; artist: string | null; artwork_url?: string | null; }
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
<div style="font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#888;margin-top:4px">${d.artist || ""}</div>` : "";
    const html = `${eyebrow(M)}${big("You're in.")}
<p style="margin:0 0 26px;color:#bdbdbd">${d ? "Your first unreleased track is waiting. Nobody outside this list has it." : "You're on the list. Unreleased tracks, early tickets and show drops land here first."}</p>
${cover}
${btn(play, d ? "&#9654;&nbsp; Play it now" : "Open my page")}
<p style="margin:0 0 8px;color:#bdbdbd">Next up: early tickets, show drops, and a vote on what we release next.</p>
${m.referral_code ? `<p style="margin:26px 0 0;padding:18px;border:1px dashed #333;font-size:14px;color:#bdbdbd">Bring people in and you move up for guest list spots. Your link:<br><a href="${refUrl(m)}" style="color:#fff;word-break:break-all">${refUrl(m)}</a></p>` : ""}
<p style="margin:26px 0 0;color:#bdbdbd">See you down there.<br>Dylan</p>`;
    const text = `You're in.\n\n${d ? `Your first unreleased track is waiting: ${track}. Nobody outside this list has it.\n\nPlay it now: ${play}` : `You're on the list. Open your page: ${play}`}\n\nNext up: early tickets, show drops, and a vote on what we release next.\n${m.referral_code ? `\nBring people in and move up for guest list spots: ${refUrl(m)}\n` : ""}\nSee you down there.\nDylan`;
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
  signin: (m, extra) => {
    const code = extra?.code ? String(extra.code) : "";
    const u = meUrl(m) + (extra?.rejoin ? "&rejoin=1" : "");
    const big6 = code ? `<div style="margin:6px 0 22px;font:900 44px/1 ${FONT};letter-spacing:.32em;color:#fff">${code}</div>` : "";
    const html = `${eyebrow(M)}${big(code ? "Your code" : "Sign in")}
${big6}<p style="margin:0 0 6px;color:#bdbdbd">${code ? "Type it on the site to sign in. It works for 10 minutes." : "Tap below to open your page on this device."}</p>
${btn(u, code ? "Or tap to sign in" : "Open my page")}<p style="margin:0;color:#888;font-size:14px">Didn't ask for this? Ignore it and nothing changes.</p>`;
    const text = `${code ? `Your ${M} sign-in code: ${code}\n\nType it on the site. It works for 10 minutes.\n\nOr tap to sign in: ${u}` : `Open your ${M} page on this device:\n${u}`}\n\nDidn't ask for this? Ignore it and nothing changes.`;
    return { subject: code ? `${code} is your ${M} code` : `your ${M} sign-in link`, ...wrap(m, html, text, code ? "Type it on the site to sign in." : "") };
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
