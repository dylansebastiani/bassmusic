// The ticket email, in the T.O.F.T.U. look. A pure function of its data, so it can be
// previewed with sample data before it ever sends. Tables + inline styles + PNG/JPG only:
// Gmail, Apple Mail and Outlook all draw it the same, and bgcolor keeps it black in light mode.

export interface EmailTicket {
  typeName: string;
  nightIdx: number[];        // 0 = night one (orange), 1 = night two (violet); both = a pass
  nightLabels: string;       // "Fri Jan 8" or "Fri Jan 8 + Sat Jan 9"
  holder: string | null;
  code: string;
  ticketUrl: string;
  qrUrl: string;
  artist?: boolean;          // the gold Artist Pass
}
export interface EmailData {
  comp: boolean;
  buyerName: string | null;
  eventName: string;
  venue: string | null;
  address: string | null;
  age: string | null;
  revealText?: string | null; // set while the address is held back: "Fri Jan 1 at 12 PM"
  secretUntil?: string | null; // an artist got the address early: keep it quiet until this time
  nights: { label: string; doors: string | null }[];
  tickets: EmailTicket[];
  subtotalCents: number;
  discountCents: number;
  feeCents: number;
  totalCents: number;
  contactEmail: string;
  mailingAddress: string;
  siteUrl: string;           // https://subduction.art (images live under /assets/toftu/email/)
  eventUrl: string;          // public event page
  artistUrl?: string | null; // set on an artist's own pass: their private guest-list page
}

const GOLD = "#F2C14E", ORANGE = "#FF5A1F", VIOLET = "#AA6EFF", UV = "#2D1052", LAV = "#B5A1C8", CARD = "#0D0716";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const HEAVY = "'Archivo Black','Arial Black',Arial,Helvetica,sans-serif";
const MONO = "'Space Mono','Courier New',Courier,monospace";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const usd = (c: number) => "$" + (c / 100).toFixed(2);
const nightColor = (i: number) => (i % 2 ? VIOLET : ORANGE);

// Gmail on iPhone repaints emails in dark mode: it flips dark backgrounds light and light text dark,
// which turns this all-black email white. Two standard fixes, applied to the finished HTML:
//  1. every background is also set as a gradient image, which Gmail leaves alone;
//  2. text cells are wrapped in two blend layers (screen, then difference) that flip Gmail's
//     repaint back. The "u + .body" selector only matches inside Gmail, so other apps never see it.
const GMAIL_CSS = `<style>:root{color-scheme:dark;supported-color-schemes:dark}
u + .body .gs{background:#000;mix-blend-mode:screen;display:block}
u + .body .gd{background:#000;mix-blend-mode:difference;display:block}
u + .body .gsi{background:#000;mix-blend-mode:screen;display:inline-block}
u + .body .gdi{background:#000;mix-blend-mode:difference;display:inline-block}</style>`;
const LIGHT_BG = /bgcolor="#(FF5A1F|FFFFFF|8A2BE2|AA6EFF|F2C14E)"/i;
export function gmailSafe(html: string) {
  html = html.replace("</head>", GMAIL_CSS + "</head>").replace(/<body /, '<body class="body" ');
  // backgrounds: add the same color as an image so Gmail keeps it
  html = html.replace(/background:(#[0-9A-Fa-f]{6})(;|")/g, (_, c, end) => `background:${c};background-image:linear-gradient(${c},${c})${end}`);
  // text cells (no nested tables or images, not the orange/white/violet blocks): wrap for the blend fix
  return html.replace(/<td([^>]*)>((?:(?!<td|<\/td>|<table|<img)[\s\S])*?)<\/td>/g, (m, attrs, inner) => {
    if (LIGHT_BG.test(attrs) || !inner.replace(/<[^>]+>|&nbsp;|\s/g, "")) return m;
    return `<td${attrs}><div class="gs"><div class="gd">${inner}</div></div></td>`;
  });
}

export function renderTicketEmail(d: EmailData): { subject: string; html: string; text: string } {
  // Ticket emails are transactional, so the postal address is only shown once a real one is set.
  const addr = /TBD/i.test(d.mailingAddress || "") ? "" : d.mailingAddress;
  const IMG = d.siteUrl.replace(/\/$/, "") + "/assets/toftu/email/";
  const artist = !!d.artistUrl;
  // An artist is greeted by their whole artist name ("You're in, Treegaud."); everyone else by first name.
  const first = artist ? (d.buyerName || "").trim() : (d.buyerName || "").trim().split(/\s+/)[0];
  const subject = artist ? `Your artist pass: ${d.eventName}` : d.comp ? `You're on the list: ${d.eventName}` : `Your tickets: ${d.eventName}`;
  const pre = artist ? "Your artist pass, your guest list and your track upload link are inside." : d.comp ? (d.address ? "You're on the guest list. Your QR code and the secret location are inside." : `You're on the guest list. The location drops ${d.revealText || "before the show"}.`)
    : `${d.tickets.length} ticket${d.tickets.length > 1 ? "s" : ""} inside${d.address ? ", plus the secret location" : `. The location drops ${d.revealText || "before the show"}`}.`;
  const maps = d.address ? "https://maps.google.com/?q=" + encodeURIComponent(d.address) : null;

  const nightRows = d.nights.map((n, i) => `
<tr><td style="padding:6px 0;font:700 13px/1.4 ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${artist ? GOLD : nightColor(i)}">${esc(n.label)}</td>
<td align="right" style="padding:6px 0;font:700 13px/1.4 ${MONO};letter-spacing:.08em;text-transform:uppercase;color:#E7E0F0">${esc(n.doors || "")}</td></tr>`).join("");

  const cards = d.tickets.map((t, i) => {
    const pass = t.nightIdx.length > 1;
    const color = t.artist ? GOLD : pass ? "#FFFFFF" : nightColor(t.nightIdx[0] ?? 0);
    const bar = t.artist ? `<td height="6" colspan="2" bgcolor="${GOLD}" style="background:${GOLD};font-size:0;line-height:0">&nbsp;</td>` : pass
      ? `<td height="6" width="50%" bgcolor="${ORANGE}" style="background:${ORANGE};font-size:0;line-height:0">&nbsp;</td><td height="6" width="50%" bgcolor="#8A2BE2" style="background:#8A2BE2;font-size:0;line-height:0">&nbsp;</td>`
      : `<td height="6" colspan="2" bgcolor="${color}" style="background:${color};font-size:0;line-height:0">&nbsp;</td>`;
    const eyes = t.artist ? "" : t.nightIdx.map((n) => `<img src="${IMG}eye-${n % 2 ? "sat" : "fri"}.png" width="30" height="30" alt="" style="display:inline-block;vertical-align:middle;border:0;margin-right:4px">`).join("");
    return `
<tr><td style="padding:0 0 22px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background:${CARD};border:1px solid ${t.artist ? GOLD : UV}">
<tr>${bar}</tr>
<tr><td colspan="2" style="padding:18px 20px 4px">
  ${eyes}<span class="gsi" style="vertical-align:middle"><span class="gdi"><span style="font:400 22px/1.2 ${HEAVY};color:${color};text-transform:uppercase;vertical-align:middle">${esc(t.typeName)}</span></span></span>
  ${d.tickets.length > 1 ? `<span style="font:700 12px ${MONO};color:${LAV};vertical-align:middle;margin-left:6px">${i + 1}/${d.tickets.length}</span>` : ""}
</td></tr>
<tr><td colspan="2" style="padding:2px 20px 16px;font:700 12px/1.6 ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${LAV}">${esc(t.nightLabels)}${t.holder ? " &nbsp;·&nbsp; " + esc(t.holder) : ""}${t.artist ? ` &nbsp;·&nbsp; <span style="color:${GOLD}">ARTIST · ALL ACCESS</span>` : d.comp ? " &nbsp;·&nbsp; GUEST LIST" : ""}</td></tr>
<tr><td colspan="2" align="center" style="padding:0 20px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF"><tr><td style="padding:14px">
  <a href="${t.ticketUrl}"><img src="${t.qrUrl}" width="232" height="232" alt="Ticket QR code ${esc(t.code)}" style="display:block;border:0;width:232px;height:232px"></a>
  </td></tr></table>
</td></tr>
<tr><td colspan="2" align="center" style="padding:14px 20px 4px;font:700 22px/1 ${MONO};letter-spacing:.32em;color:${t.artist ? GOLD : "#FFFFFF"}">${esc(t.code)}</td></tr>
<tr><td colspan="2" align="center" style="padding:2px 20px 18px;font:12px/1.5 ${SANS};color:${LAV}">Backup code if the scanner can't read your screen</td></tr>
<tr><td colspan="2" align="center" style="padding:0 20px 22px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${t.artist ? GOLD : ORANGE}" style="background:${t.artist ? GOLD : ORANGE}">
  <a href="${t.ticketUrl}" style="display:inline-block;padding:14px 26px;font:400 14px/1 ${HEAVY};letter-spacing:.12em;text-transform:uppercase;color:#050505;text-decoration:none">${t.artist ? "Open artist pass" : "Open ticket"}</a>
  </td></tr></table>
</td></tr>
</table></td></tr>`;
  }).join("");

  const summary = d.comp ? "" : `
<tr><td style="padding:4px 0 26px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${UV};border-bottom:1px solid ${UV}">
<tr><td style="padding:12px 0 4px;font:13px ${SANS};color:${LAV}">Tickets</td><td align="right" style="padding:12px 0 4px;font:13px ${SANS};color:#E7E0F0">${usd(d.subtotalCents)}</td></tr>
${d.discountCents ? `<tr><td style="padding:4px 0;font:13px ${SANS};color:${LAV}">Promo code</td><td align="right" style="padding:4px 0;font:13px ${SANS};color:#E7E0F0">−${usd(d.discountCents)}</td></tr>` : ""}
${d.feeCents ? `<tr><td style="padding:4px 0;font:13px ${SANS};color:${LAV}">Card processing fee</td><td align="right" style="padding:4px 0;font:13px ${SANS};color:#E7E0F0">${usd(d.feeCents)}</td></tr>` : ""}
<tr><td style="padding:8px 0 12px;font:400 15px ${HEAVY};color:#FFFFFF;text-transform:uppercase">Total paid</td><td align="right" style="padding:8px 0 12px;font:400 15px ${HEAVY};color:#FFFFFF">${usd(d.totalCents)}</td></tr>
</table></td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#050505" bgcolor="#050505">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#050505">${esc(pre)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#050505" style="background:#050505"><tr><td align="center" style="padding:0 0 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">

<tr><td><a href="${d.eventUrl}"><img src="${IMG}hero.jpg" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a></td></tr>
<tr><td align="center" style="padding:18px 24px 0"><img src="${IMG}${artist ? "wordmark-gold" : "wordmark"}.png" width="300" alt="T.O.F.T.U." style="display:block;width:300px;max-width:80%;height:auto;border:0"></td></tr>
<tr><td align="center" style="padding:14px 24px 0"><img src="${IMG}ftu.png" width="340" alt="FOR THE UNDERGROUND" style="display:block;width:340px;max-width:86%;height:auto;border:0"></td></tr>

<tr><td style="padding:30px 24px 0;color:#E7E0F0;font:16px/1.6 ${SANS}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="font:700 12px ${MONO};letter-spacing:.3em;text-transform:uppercase;color:${artist ? GOLD : ORANGE};padding-bottom:10px">${artist ? "Artist pass" : d.comp ? "Guest list" : "Order confirmed"}</td></tr>
<tr><td style="font:400 34px/1.05 ${HEAVY};color:#FFFFFF;text-transform:uppercase;padding-bottom:12px">${first ? `You're in, ${esc(first)}.` : "You're in."}</td></tr>
<tr><td style="font:15px/1.6 ${SANS};color:#D9D2E3;padding-bottom:26px">${artist ? "You're on the bill. Your artist pass is below: show the QR code at the door, both nights." : d.comp ? "You're on the guest list. Your ticket is below: show the QR code at the door." : "Your tickets are below. Show the QR code at the door, on your phone or printed."} Each code works once per night, so don't share screenshots.</td></tr>

${d.address ? `<tr><td style="padding:0 0 26px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background:${CARD};border:1px solid ${UV}">
<tr><td style="padding:18px 20px 4px;font:700 12px ${MONO};letter-spacing:.3em;text-transform:uppercase;color:${artist ? GOLD : ORANGE}">The secret location</td></tr>
<tr><td style="padding:2px 20px 2px;font:400 24px/1.2 ${HEAVY};color:#FFFFFF;text-transform:uppercase">${esc(d.venue || "")}</td></tr>
<tr><td style="padding:2px 20px 10px;font:15px/1.5 ${SANS}"><a href="${maps}" style="color:#E7E0F0;text-decoration:underline">${esc(d.address)}</a></td></tr>
<tr><td style="padding:0 20px 14px;font:13px/1.5 ${SANS};color:${d.secretUntil ? GOLD : LAV}">${d.secretUntil ? `Artists get it first. It stays secret until ${esc(d.secretUntil)}, when it goes out to ticket holders, so please don't share or post it before then.` : "Keep it underground: please don't post the address."}</td></tr>
<tr><td style="padding:0 20px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${UV}">${nightRows}
${d.age ? `<tr><td colspan="2" style="padding:8px 0 2px;font:700 13px ${MONO};letter-spacing:.08em;text-transform:uppercase;color:#FFFFFF">${esc(d.age)} &nbsp;·&nbsp; Bring ID</td></tr>` : ""}</table></td></tr>
</table></td></tr>` : d.revealText ? `<tr><td style="padding:0 0 26px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background:${CARD};border:1px solid ${UV}">
<tr><td style="padding:18px 20px 4px;font:700 12px ${MONO};letter-spacing:.3em;text-transform:uppercase;color:${artist ? GOLD : ORANGE}">The secret location</td></tr>
<tr><td style="padding:2px 20px 2px;font:400 24px/1.2 ${HEAVY};color:#FFFFFF;text-transform:uppercase">Drops ${esc(d.revealText)}</td></tr>
<tr><td style="padding:6px 20px 14px;font:15px/1.5 ${SANS};color:#D9D2E3">We'll email the address to you one week before the show. Keep this email: your tickets are below.</td></tr>
<tr><td style="padding:0 20px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${UV}">${nightRows}
${d.age ? `<tr><td colspan="2" style="padding:8px 0 2px;font:700 13px ${MONO};letter-spacing:.08em;text-transform:uppercase;color:#FFFFFF">${esc(d.age)} &nbsp;·&nbsp; Bring ID</td></tr>` : ""}</table></td></tr>
</table></td></tr>` : ""}

${artist ? `<tr><td style="padding:0 0 26px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background:${CARD};border:1px solid ${GOLD}">
<tr><td style="padding:18px 20px 4px;font:700 12px ${MONO};letter-spacing:.3em;text-transform:uppercase;color:${GOLD}">Your guest list + your tracks</td></tr>
<tr><td style="padding:2px 20px 14px;font:15px/1.5 ${SANS};color:#D9D2E3">Put your people on the list from your own page: name, email and phone. Each one gets a real ticket by email. You can add or remove guests until doors open.<br><br>On the same page you can add your own tracks to the show's playlist. They go straight into the mix on the show's page, and you choose whether fans can download each one free.</td></tr>
<tr><td style="padding:0 20px 20px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${GOLD}" style="background:${GOLD}">
<a href="${d.artistUrl}" style="display:inline-block;padding:14px 26px;font:400 14px/1 ${HEAVY};letter-spacing:.12em;text-transform:uppercase;color:#050505;text-decoration:none">Guest list + tracks</a>
</td></tr></table></td></tr>
<tr><td style="padding:0 20px 18px;font:12px/1.5 ${SANS};color:${LAV}">This link is yours only. Don't share it publicly.</td></tr>
</table></td></tr>` : ""}
${cards}
${summary}

<tr><td style="padding:6px 0 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="25%" valign="bottom"><img src="${IMG}${artist ? "figure-gold" : "figure-fri"}.png" width="120" alt="" style="display:block;width:120px;max-width:100%;height:auto;border:0"></td>
<td align="center" valign="middle" style="font:400 18px/1.25 ${HEAVY};color:#FFFFFF;text-transform:uppercase">See you<br>underground</td>
<td width="25%" valign="bottom" align="right"><img src="${IMG}${artist ? "figure-gold" : "figure-sat"}.png" width="120" alt="" style="display:block;width:120px;max-width:100%;height:auto;border:0;margin-left:auto"></td>
</tr></table></td></tr>

<tr><td align="center" style="padding:26px 0 22px"><img src="${IMG}partners-v3.png" height="40" alt="" style="display:block;height:40px;width:auto;border:0;margin:0 auto"></td></tr>

<tr><td style="padding:26px 0 0;border-top:1px solid #1C1228;font:12px/1.7 ${SANS};color:#8E84A0">
Your ticket also makes you a Subduction member: unreleased tracks and first word on shows, by email. You can unsubscribe from those anytime.<br><br>
Questions or need a change? Reply to this email or write <a href="mailto:${esc(d.contactEmail)}" style="color:${LAV}">${esc(d.contactEmail)}</a>.<br>
<a href="${d.eventUrl}" style="color:${LAV}">Event page</a> ${addr ? "&nbsp;·&nbsp; " + esc(addr) : ""}</td></tr>

</table></td></tr></table>
</td></tr></table></body></html>`;

  const text = [
    `${artist ? "Your artist pass" : d.comp ? "You're on the guest list" : "Your tickets"} for ${d.eventName}`,
    artist ? `\nYOUR GUEST LIST + TRACKS: add your people (until doors open) and add your tracks to the show's playlist here: ${d.artistUrl}` : "",
    d.address ? `\nTHE SECRET LOCATION\n${d.venue || ""}\n${d.address}\n${d.secretUntil ? `Artists get it first. It stays secret until ${d.secretUntil}, so please don't share or post it before then.` : "Keep it underground: please don't post the address."}` : d.revealText ? `\nTHE SECRET LOCATION drops ${d.revealText}. We'll email it to you.` : "",
    d.nights.map((n) => `${n.label}: ${n.doors || ""}`).join("\n"),
    d.age ? `${d.age} · Bring ID` : "",
    "",
    ...d.tickets.map((t) => `${t.typeName} (${t.nightLabels})${t.holder ? " · " + t.holder : ""}\nCode: ${t.code}\n${t.ticketUrl}`),
    d.comp ? "" : `\nTotal paid: ${usd(d.totalCents)}${d.feeCents ? ` (incl. ${usd(d.feeCents)} card fee)` : ""}`,
    "\nShow the QR code at the door. Each code works once per night.",
    "\nYour ticket also makes you a Subduction member: unreleased tracks and first word on shows, by email. Unsubscribe from those anytime.",
    `\nQuestions? ${d.contactEmail}${addr ? "\n" + addr : ""}`,
  ].filter((x) => x !== "").join("\n");

  return { subject, html: gmailSafe(html), text };
}

// Reveal day: the address, sent once to everyone who already has a ticket.
export interface LocationData {
  buyerName: string | null; eventName: string; venue: string | null; address: string; age: string | null;
  nights: { label: string; doors: string | null }[]; contactEmail: string; siteUrl: string; eventUrl: string;
}
export function renderLocationEmail(d: LocationData): { subject: string; html: string; text: string } {
  const IMG = d.siteUrl.replace(/\/$/, "") + "/assets/toftu/email/";
  const first = (d.buyerName || "").trim().split(/\s+/)[0];
  const subject = `The location is in: ${d.eventName}`;
  const maps = "https://maps.google.com/?q=" + encodeURIComponent(d.address);
  const rows = d.nights.map((n, i) => `<tr><td style="padding:6px 0;font:700 13px/1.4 ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${nightColor(i)}">${esc(n.label)}</td><td align="right" style="padding:6px 0;font:700 13px/1.4 ${MONO};letter-spacing:.08em;text-transform:uppercase;color:#E7E0F0">${esc(n.doors || "")}</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#050505" bgcolor="#050505">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#050505">The secret location for ${esc(d.eventName)}. Keep it underground.&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#050505" style="background:#050505"><tr><td align="center" style="padding:0 0 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
<tr><td><a href="${d.eventUrl}"><img src="${IMG}hero.jpg" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a></td></tr>
<tr><td align="center" style="padding:18px 24px 0"><img src="${IMG}wordmark.png" width="300" alt="T.O.F.T.U." style="display:block;width:300px;max-width:80%;height:auto;border:0"></td></tr>
<tr><td style="padding:30px 24px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="font:700 12px ${MONO};letter-spacing:.3em;text-transform:uppercase;color:${ORANGE};padding-bottom:10px">One week out</td></tr>
<tr><td style="font:400 34px/1.05 ${HEAVY};color:#FFFFFF;text-transform:uppercase;padding-bottom:12px">${first ? `Here it is, ${esc(first)}.` : "Here it is."}</td></tr>
<tr><td style="font:15px/1.6 ${SANS};color:#D9D2E3;padding-bottom:26px">The secret location for ${esc(d.eventName)}. Your tickets are in your earlier email: show the QR code at the door.</td></tr>
<tr><td style="padding:0 0 26px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background:${CARD};border:1px solid ${UV}">
<tr><td style="padding:18px 20px 4px;font:700 12px ${MONO};letter-spacing:.3em;text-transform:uppercase;color:${ORANGE}">The secret location</td></tr>
<tr><td style="padding:2px 20px 2px;font:400 26px/1.2 ${HEAVY};color:#FFFFFF;text-transform:uppercase">${esc(d.venue || "")}</td></tr>
<tr><td style="padding:2px 20px 10px;font:16px/1.5 ${SANS}"><a href="${maps}" style="color:#E7E0F0;text-decoration:underline">${esc(d.address)}</a></td></tr>
<tr><td style="padding:0 20px 14px;font:13px/1.5 ${SANS};color:${LAV}">Keep it underground: please don't post the address.</td></tr>
<tr><td style="padding:0 20px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${UV}">${rows}
${d.age ? `<tr><td colspan="2" style="padding:8px 0 2px;font:700 13px ${MONO};letter-spacing:.08em;text-transform:uppercase;color:#FFFFFF">${esc(d.age)} &nbsp;·&nbsp; Bring ID</td></tr>` : ""}</table></td></tr>
</table></td></tr>
</table></td></tr>
<tr><td align="center" style="padding:6px 0 22px"><img src="${IMG}partners-v3.png" height="40" alt="" style="display:block;height:40px;width:auto;border:0;margin:0 auto"></td></tr>
<tr><td style="padding:22px 24px 0;border-top:1px solid #1C1228;font:12px/1.7 ${SANS};color:#8E84A0">Questions? Reply to this email or write <a href="mailto:${esc(d.contactEmail)}" style="color:${LAV}">${esc(d.contactEmail)}</a>.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`The secret location for ${d.eventName}`, "", d.venue || "", d.address, "Keep it underground: please don't post the address.", "",
    d.nights.map((n) => `${n.label}: ${n.doors || ""}`).join("\n"), d.age ? `${d.age} · Bring ID` : "", "",
    "Your tickets are in your earlier email. Show the QR code at the door.", `Questions? ${d.contactEmail}`].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
  return { subject, html: gmailSafe(html), text };
}
