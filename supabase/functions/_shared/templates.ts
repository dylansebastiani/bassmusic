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
const meUrl = (m: Member) => `${SITE_URL}/in.html?t=${m.access_token}`;
export const unsubUrl = (m: Member) => `${FN}/unsubscribe?u=${m.unsubscribe_token}`;

// Plain, personal-looking HTML. No images, one button.
function wrap(m: Member, bodyHtml: string, bodyText: string): Omit<Rendered, "subject"> {
  const foot = `${L} · ${CONFIG.mailingAddress}`;
  return {
    html: `<!doctype html><html><body style="margin:0;padding:24px 16px;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto">${bodyHtml}
<p style="margin-top:36px;font-size:12px;color:#888;line-height:1.6">You're getting this because you joined ${M}.<br>
<a href="${unsubUrl(m)}" style="color:#aaa">Unsubscribe</a> · ${foot}</p></div></body></html>`,
    text: `${bodyText}\n\n--\nYou're getting this because you joined ${M}.\nUnsubscribe: ${unsubUrl(m)}\n${foot}`,
  };
}
const btn = (href: string, label: string) =>
  `<p style="margin:28px 0"><a href="${href}" style="display:inline-block;background:#fff;color:#000;text-decoration:none;font-weight:800;letter-spacing:.14em;text-transform:uppercase;padding:16px 26px;font-size:13px">${label}</a></p>`;

type Tpl = (m: Member, extra?: Record<string, unknown>) => Rendered;

export const TEMPLATES: Record<string, Tpl> = {
  // 1. Immediate
  welcome: (m) => {
    const html = `<p>${hi(m)},</p>
<p>you're under. ${M} gets unreleased tracks first, guest list drawings at every show, and the drops nobody else gets.</p>
<p>First thing: there's a bonus track waiting for you. Tap below and it's yours.</p>
${btn(confirmUrl(m), "Unlock the bonus track")}
<p>Your member page (the track you heard when you joined is there): <a href="${meUrl(m)}" style="color:#fff">${meUrl(m)}</a></p>
${m.referral_code ? `<p style="color:#bbb">Know people who'd want this? Send them your link and you move up the list for guest spots:<br><a href="${refUrl(m)}" style="color:#fff">${refUrl(m)}</a></p>` : ""}
<p>— Dylan</p>`;
    const text = `${hi(m)},\n\nyou're under. ${M} gets unreleased tracks first, guest list drawings at every show, and the drops nobody else gets.\n\nFirst thing: there's a bonus track waiting for you:\n${confirmUrl(m)}\n\nYour member page: ${meUrl(m)}\n${m.referral_code ? `\nYour referral link: ${refUrl(m)}\n` : ""}\n— Dylan`;
    return { subject: "you're under (bonus track inside)", ...wrap(m, html, text) };
  },
  // 2. +2 days
  story: (m) => {
    const html = `<p>${hi(m)},</p><p>quick one on why ${L} exists.</p>
<p>Bass music needed a home around here again. Rooms that feel safe, sound that actually hits, and a crew that puts the community before the headcount. That's the whole idea. ${M} is how we keep the people who care close.</p>
<p>Do me a favour: hit reply and tell me your city. One word is fine. It's how I figure out where to book next.</p><p>— Dylan</p>`;
    const text = `${hi(m)},\n\nquick one on why ${L} exists.\n\nBass music needed a home around here again. Rooms that feel safe, sound that actually hits, and a crew that puts the community before the headcount. ${M} is how we keep the people who care close.\n\nDo me a favour: hit reply and tell me your city. One word is fine.\n\n— Dylan`;
    return { subject: "why we started this", ...wrap(m, html, text) };
  },
  // 3. +4 days
  vote: (m) => {
    const a = `${SITE_URL}/in.html?vote=a&t=${m.access_token}`, b = `${SITE_URL}/in.html?vote=b&t=${m.access_token}`;
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
    const u = `${SITE_URL}/in.html?t=${m.access_token}#birthday`;
    const html = `<p>${hi(m)},</p><p>we want to send you something on your birthday. Drop the date on your member page and it's handled. It also sorts out age checks for 18+ and 21+ shows.</p>${btn(u, "Add my birthday")}<p>— Dylan</p>`;
    const text = `${hi(m)},\n\nwe want to send you something on your birthday. Add the date here:\n${u}\n\n— Dylan`;
    return { subject: "we want to send you something on your birthday", ...wrap(m, html, text) };
  },
  // 7. +21 days
  featured: (m) => {
    const u = `${SITE_URL}/in.html?t=${m.access_token}#ig`;
    const html = `<p>${hi(m)},</p><p>we repost members at shows and in drops. Want in? Add your Instagram handle and we'll find you in the crowd.</p>${btn(u, "Add my Instagram")}<p>— Dylan</p>`;
    const text = `${hi(m)},\n\nwe repost members at shows and in drops. Add your Instagram handle here:\n${u}\n\n— Dylan`;
    return { subject: "want to get featured?", ...wrap(m, html, text) };
  },
  // Sign-in link: someone typed this email on a phone we don't know yet.
  signin: (m, extra) => {
    const u = meUrl(m) + (extra?.rejoin ? "&rejoin=1" : "");
    const html = `<p>${hi(m)},</p><p>tap below to open your ${M} page on this device. Your track, your shows and your unlocks are all there.</p>
${btn(u, "Open my page")}<p style="color:#bbb">Didn't ask for this? Ignore it and nothing changes.</p><p>— Dylan</p>`;
    const text = `${hi(m)},\n\nopen your ${M} page on this device:\n${u}\n\nDidn't ask for this? Ignore it and nothing changes.\n\n— Dylan`;
    return { subject: `your ${M} sign-in link`, ...wrap(m, html, text) };
  },
  // Referral rewards
  reward: (m, extra) => {
    const label = String(extra?.label || "a reward");
    const html = `<p>${hi(m)},</p><p>you got people in. That unlocks: <b>${label}</b>.</p><p>Reply to this email and we'll sort the details. Thank you for actually bringing people. That's the whole thing.</p><p>— Dylan</p>`;
    const text = `${hi(m)},\n\nyou got people in. That unlocks: ${label}.\n\nReply to this email and we'll sort the details.\n\n— Dylan`;
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
