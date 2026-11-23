/* Lineup profiles: on a show page, an artist's name in the lineup becomes tappable and opens their
   photo, bio and links (what they filled in from their artist pass page). Works on both show page
   builders: it only looks for lineup list items, and does nothing if no artist has a profile. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/artist";
  var q = new URLSearchParams(location.search);
  var path = (location.pathname.match(/^\/([a-z0-9-]+)\/?$/i) || [])[1];
  var slug = (window.__SHOW_SLUG || q.get("e") || (path && !/\.html$/.test(path) ? path : "") || (/tickets\.html$/.test(location.pathname) ? "underground" : ""))
    .replace(/[^a-z0-9-]/gi, "").toLowerCase();
  if (!slug) return;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var LABEL = { instagram: "Instagram", soundcloud: "SoundCloud", spotify: "Spotify", tiktok: "TikTok", youtube: "YouTube", website: "Website" };
  var artists = [];

  var css = document.createElement("style");
  css.textContent =
    ".lu-a{all:unset;cursor:pointer;border-bottom:1px dotted currentColor}.lu-a:hover,.lu-a:focus-visible{opacity:.8;outline:none}" +
    ".lu-bg{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.78);display:flex;align-items:flex-end;justify-content:center;padding:16px}" +
    "@media(min-width:640px){.lu-bg{align-items:center}}" +
    ".lu-card{position:relative;width:100%;max-width:420px;max-height:88vh;overflow:auto;background:#0b0b10;color:#f3effa;border:1px solid rgba(255,255,255,.18);padding:22px;font:15px/1.55 system-ui,sans-serif}" +
    ".lu-card img{width:100%;aspect-ratio:1;object-fit:cover;display:block;margin-bottom:16px}" +
    ".lu-card h3{margin:0 0 4px;font-size:26px;line-height:1.1;text-transform:uppercase;letter-spacing:.02em}" +
    ".lu-meta{font:700 12px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;opacity:.7;margin-bottom:12px}" +
    ".lu-bio{margin:0 0 16px;white-space:pre-line}" +
    ".lu-links{display:flex;flex-wrap:wrap;gap:8px}.lu-links a{border:1px solid rgba(255,255,255,.35);color:inherit;text-decoration:none;padding:8px 12px;font:700 12px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}" +
    ".lu-x{position:absolute;top:8px;right:10px;background:none;border:0;color:inherit;font-size:28px;line-height:1;cursor:pointer;padding:6px}";
  document.head.appendChild(css);

  function open(a) {
    var bg = document.createElement("div"); bg.className = "lu-bg"; bg.setAttribute("role", "dialog"); bg.setAttribute("aria-modal", "true"); bg.setAttribute("aria-label", a.name);
    var meta = [a.hometown, a.genre].filter(Boolean).map(esc).join(" · ");
    var links = Object.keys(LABEL).filter(function (k) { return a.links && /^https:\/\//.test(a.links[k] || ""); })
      .map(function (k) { return '<a href="' + esc(a.links[k]) + '" target="_blank" rel="noopener nofollow">' + LABEL[k] + "</a>"; }).join("");
    bg.innerHTML = '<div class="lu-card"><button class="lu-x" type="button" aria-label="Close">&times;</button>' +
      (a.photo_url ? '<img src="' + esc(a.photo_url) + '" alt="' + esc(a.name) + '">' : "") +
      "<h3>" + esc(a.name) + "</h3>" + (meta ? '<div class="lu-meta">' + meta + "</div>" : "") +
      (a.bio ? '<p class="lu-bio">' + esc(a.bio) + "</p>" : "") + (links ? '<div class="lu-links">' + links + "</div>" : "") + "</div>";
    var close = function () { bg.remove(); document.removeEventListener("keydown", key); };
    var key = function (e) { if (e.key === "Escape") close(); };
    bg.addEventListener("click", function (e) { if (e.target === bg || e.target.closest(".lu-x")) close(); });
    document.addEventListener("keydown", key);
    document.body.appendChild(bg); bg.querySelector(".lu-x").focus();
  }

  // Turn each artist's name inside a lineup item into a button. Handles "A b2b B" (both become tappable).
  function mark() {
    if (!artists.length) return;
    var names = artists.slice().sort(function (x, y) { return y.name.length - x.name.length; });
    document.querySelectorAll("#nights li, .s-nights li").forEach(function (li) {
      if (li.getAttribute("data-lu")) return;
      var t = li.firstChild; if (!t || t.nodeType !== 3) return;
      var text = t.nodeValue, html = "", i = 0, hit = false;
      while (i < text.length) {
        var m = null;
        for (var j = 0; j < names.length && !m; j++) {
          var n = names[j].name, seg = text.substr(i, n.length);
          var before = i === 0 || !/[a-z0-9]/i.test(text[i - 1]), after = !/[a-z0-9]/i.test(text[i + n.length] || "");
          if (seg.toLowerCase() === n.toLowerCase() && before && after) m = names[j];
        }
        if (m) { html += '<button type="button" class="lu-a" data-lu-i="' + artists.indexOf(m) + '">' + esc(text.substr(i, m.name.length)) + "</button>"; i += m.name.length; hit = true; }
        else { html += esc(text[i]); i++; }
      }
      li.setAttribute("data-lu", "1");
      if (!hit) return;
      var span = document.createElement("span"); span.innerHTML = html; li.replaceChild(span, t);
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".lu-a"); if (!b) return;
    var a = artists[+b.getAttribute("data-lu-i")]; if (a) { e.preventDefault(); open(a); }
  });

  fetch(FN + "?a=lineup&e=" + encodeURIComponent(slug)).then(function (r) { return r.ok ? r.json() : { artists: [] }; }).then(function (d) {
    artists = (d.artists || []).filter(function (a) { return a && a.name; });
    if (!artists.length) return;
    mark();
    // The lineup is drawn after the page loads (and redrawn on updates), so keep watching for it.
    new MutationObserver(function () { mark(); }).observe(document.body, { childList: true, subtree: true });
  }).catch(function () {});
})();
