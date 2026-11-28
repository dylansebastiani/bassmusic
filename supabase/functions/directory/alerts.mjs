// City show alerts: pure helpers for the directory function (index.ts) and the tests.
// A fan picks a city on /shows. When a new show for that city shows up in the directory, they get one email.
// Every email has a visible unsubscribe link (a token, never the email), List-Unsubscribe headers and the mailing address.

export const TOKEN_RE = /^[0-9a-f]{64}$/;
export const PATH_RE = /^[a-z0-9-]{1,48}$/;

// A stable key for one listing on one date. The same show seen again on a later sweep makes the same key.
export function showKey(card) {
  if (!card || !card.name || !card.path) return "";
  const id = card.slug || card.url || card.name;
  return String((card.source || "x") + ":" + id + ":" + ((card.dates || [])[0] || "")).slice(0, 300);
}

// "Chicago, IL" -> { path: "chicago-il", name: "Chicago, IL" }, only when it matches the path the page sent.
export function cityFrom(path, name, cityPath) {
  const p = String(path || "").trim().toLowerCase();
  const n = String(name || "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!PATH_RE.test(p) || p === "review") return null;
  const m = n.match(/^(.+),\s*([A-Za-z]{2})$/);
  if (!m || cityPath(m[1], m[2]) !== p) return null;
  return { path: p, name: m[1].trim() + ", " + m[2].toUpperCase(), city: m[1].trim() };
}

const abs = (site, u) => /^https:\/\//i.test(u || "") ? u : site + (String(u || "/shows").startsWith("/") ? u : "/" + u);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const F = "font-family:Arial,Helvetica,sans-serif";

function frame(title, rows, footer) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(title)}</title></head>
<body style="margin:0;background:#000"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#000;border:1px solid #2a2627">
<tr><td style="padding:22px 24px 0;font-family:'Courier New',monospace;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b6ff00">Subduction</td></tr>
${rows}
<tr><td style="padding:22px 24px 26px;${F};font-size:12px;line-height:1.6;color:#9a9490;border-top:1px solid #2a2627">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}
function footerParts(cityName, unsubUrl, address) {
  const html = `You asked to hear when a show lands in ${esc(cityName)}. <a href="${esc(unsubUrl)}" style="color:#f4f1ee">Stop these emails</a>.${address ? "<br>Subduction, " + esc(address) : ""}`;
  const text = `You asked to hear when a show lands in ${cityName}. Stop these emails: ${unsubUrl}${address ? "\n\nSubduction\n" + address : ""}`;
  return { html, text };
}

// The one email sent when a new show lands in their city. `shows` are public directory cards.
export function alertMail({ cityName, cityPath: path, shows, unsubUrl, address, site }) {
  const one = shows.length === 1;
  const subject = one ? `New show in ${cityName.split(",")[0]}: ${shows[0].name}` : `${shows.length} new shows in ${cityName.split(",")[0]}`;
  const all = `${site}/shows/${path}`;
  const line = (s) => [s.when, [s.city, s.state].filter(Boolean).join(", "), s.secret ? "Secret location" : ""].filter(Boolean).join(" · ");
  const rows = shows.map((s) => `<tr><td style="padding:18px 24px 0">
${/^https:\/\//.test(s.flyer || "") ? `<a href="${esc(abs(site, s.url))}"><img src="${esc(s.flyer)}" width="472" alt="${esc(s.name)} flyer" style="display:block;width:100%;max-width:472px;height:auto;border:1px solid #2a2627"></a>` : ""}
<div style="font-family:Impact,'Arial Narrow',sans-serif;font-size:34px;line-height:1;text-transform:uppercase;color:#f4f1ee;padding-top:14px">${esc(s.name)}</div>
<div style="${F};font-size:15px;line-height:1.5;color:#cfc9c5;padding-top:6px">${esc(line(s))}</div>
<a href="${esc(abs(site, s.url))}" style="display:block;margin-top:14px;background:#b6ff00;color:#000;${F};font-size:16px;font-weight:bold;text-align:center;text-decoration:none;padding:15px 12px;text-transform:uppercase;letter-spacing:1px">Get tickets</a></td></tr>`).join("");
  const f = footerParts(cityName, unsubUrl, address);
  const html = frame(subject, `<tr><td style="padding:10px 24px 0;font-family:Impact,'Arial Narrow',sans-serif;font-size:28px;line-height:1.05;text-transform:uppercase;color:#f4f1ee">${one ? "A new show just landed" : "New shows just landed"} in ${esc(cityName.split(",")[0])}.</td></tr>${rows}
<tr><td style="padding:18px 24px 22px;${F};font-size:14px"><a href="${esc(all)}" style="color:#b6ff00">See every ${esc(cityName.split(",")[0])} show</a></td></tr>`, f.html);
  const text = [one ? `A new show just landed in ${cityName}.` : `New shows just landed in ${cityName}.`, "",
    ...shows.flatMap((s) => [s.name, line(s), "Tickets: " + abs(site, s.url), ""]), `See every show: ${all}`, "", f.text].join("\n");
  return { subject, html, text };
}

// Sent once when someone signs up, so they know it worked and how to stop it.
export function welcomeMail({ cityName, cityPath: path, unsubUrl, address, site }) {
  const city = cityName.split(",")[0];
  const subject = `You're on the ${city} list`;
  const all = `${site}/shows/${path}`;
  const f = footerParts(cityName, unsubUrl, address);
  const html = frame(subject, `<tr><td style="padding:10px 24px 0;font-family:Impact,'Arial Narrow',sans-serif;font-size:34px;line-height:1;text-transform:uppercase;color:#f4f1ee">You're on the <span style="color:#b6ff00">${esc(city)}</span> list.</td></tr>
<tr><td style="padding:12px 24px 0;${F};font-size:15px;line-height:1.6;color:#cfc9c5">When a new show lands in ${esc(cityName)}, you get one email with the flyer and the ticket link. Nothing else.</td></tr>
<tr><td style="padding:18px 24px 22px"><a href="${esc(all)}" style="display:block;border:1px solid #6c6567;color:#f4f1ee;${F};font-size:15px;font-weight:bold;text-align:center;text-decoration:none;padding:14px 12px;text-transform:uppercase;letter-spacing:1px">See what's on now</a></td></tr>`, f.html);
  const text = [`You're on the ${city} list.`, "", `When a new show lands in ${cityName}, you get one email with the flyer and the ticket link. Nothing else.`, "", `See what's on now: ${all}`, "", f.text].join("\n");
  return { subject, html, text };
}

// Headers for every alert email: a one-click https unsubscribe (RFC 8058) plus the mailto fallback.
export function unsubHeaders(oneClickUrl) {
  return { "List-Unsubscribe": `<${oneClickUrl}>, <mailto:hello@subduction.art?subject=stop>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}
