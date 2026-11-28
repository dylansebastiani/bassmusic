// One public header and footer for the marketing pages (issue #71). scripts/build.mjs swaps these in for
// <!--SITE-NAV--> and <!--SITE-FOOT-->. Variants: <!--SITE-NAV:over--> floats over a full-bleed hero, and
// <!--SITE-NAV:bleed--> / <!--SITE-FOOT:bleed--> reach past the 18px body padding of app.css pages.
// Never used on a show page, T.O.F.T.U., tickets, the door or any staff tool. Styles live in site/assets/chrome.css.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Header order is fixed: Shows, Artists, My account, then the green Sell tickets button.
export const NAV_ITEMS = [["Shows", "/shows"], ["Artists", "/artists.html"], ["My account", "/me.html"]];
export const SELL = ["Sell tickets", "/promoter.html"];

export function siteNav(variant) {
  const links = NAV_ITEMS.map(([t, h]) => `<a href="${h}">${t}</a>`).join("");
  return `<header class="sx-bar${variant ? " sx-" + variant : ""}" id="sx-bar">
  <a class="sx-brand" href="/" aria-label="Subduction home"><img src="/assets/logo-64.webp" width="26" height="26" alt=""><b>Subduction</b></a>
  <nav class="sx-nav" aria-label="Site">${links}<a href="/collection.html" id="mine" hidden>My collection</a></nav>
  <a class="sx-go" href="${SELL[1]}">${SELL[0]}</a>
  <details class="sx-menu"><summary aria-label="Menu"><i></i><i></i><i></i></summary><nav aria-label="Menu">${links}<a href="${SELL[1]}">${SELL[0]}</a></nav></details>
</header>`;
}

// Footer groups. "Sell tickets" always means /promoter.html. The demo is only "Try a test ticket". One label: "Fees".
export function siteFoot(cfg, variant) {
  const so = (cfg && cfg.social) || {}, social = [];
  // Instagram stays out on purpose (same as the old homepage footer). An empty row is hidden by CSS.
  for (const [k, label, base] of [["tiktok", "TikTok", "https://tiktok.com/@"], ["facebook", "Facebook", "https://facebook.com/"]]) {
    const h = String(so[k] || "").replace(/^@/, "").trim();
    if (/^[A-Za-z0-9._-]{1,60}$/.test(h)) social.push(`<a href="${esc(base + h)}" target="_blank" rel="noopener">${label}</a>`);
  }
  const mail = /^[^@\s"<>]+@[^@\s"<>]+$/.test((cfg && cfg.contactEmail) || "") ? "mailto:" + cfg.contactEmail : "/privacy.html";
  const group = (title, links) => `<div class="sx-g"><p class="sx-h">${title}</p>${links.map(([t, h, cls]) => `<a href="${esc(h)}"${cls ? ` class="${cls}"` : ""}>${t}</a>`).join("")}</div>`;
  const name = esc((cfg && cfg.labelName) || "Subduction");
  return `<footer class="sx-foot${variant ? " sx-" + variant : ""}" id="foot">
  <a class="sx-brand" href="/" aria-label="Subduction home"><img src="/assets/logo-64.webp" width="28" height="28" alt="" loading="lazy"><b>${name}</b></a>
  <div class="sx-groups">
    ${group("Find a show", [["Shows", "/shows"]])}
    ${group("Your tickets", [["My account", "/me.html"], ["My collection", "/collection.html"]])}
    ${group("For crews", [["Sell tickets", "/promoter.html"], ["Fees", "/fees.html"], ["Try a test ticket", "/demo.html"]])}
    ${group("For artists", [["Artist waitlist", "/artists.html"]])}
    ${group("Legal", [["Privacy", "/privacy.html"], ["Terms", "/terms.html"], ["Contact", mail, "contact"]])}
  </div>
  <nav class="fsocial" id="fsocial" aria-label="Social">${social.join("")}</nav>
  <p class="sx-copy" id="foot-cat">&copy; ${new Date().getFullYear()} ${name}</p>
</footer>`;
}

// Swap the markers in one page. Pages without markers come back unchanged.
export function withChrome(html, cfg) {
  return html.replace(/<!--SITE-NAV(?::(over|bleed))?-->/, (m, v) => siteNav(v || "")).replace(/<!--SITE-FOOT(?::(bleed))?-->/, (m, v) => siteFoot(cfg, v || ""));
}
