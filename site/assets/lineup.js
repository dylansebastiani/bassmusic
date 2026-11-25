/* Lineup profiles: on a show page, an artist's name in the lineup becomes tappable and opens their
   card: photo, hometown and genre, bio, links (what they filled in from their artist pass page) and
   the tracks they uploaded to the show's playlist, playable right in the card. Works on both show
   page builders: it only looks for lineup list items. An artist with tracks but no profile still
   gets a card. Does nothing when no one on the lineup has either. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1";
  var q = new URLSearchParams(location.search);
  var path = (location.pathname.match(/^\/([a-z0-9-]+)\/?$/i) || [])[1];
  var slug = (window.__SHOW_SLUG || q.get("e") || (path && !/\.html$/.test(path) ? path : "") || (/tickets\.html$/.test(location.pathname) ? "underground" : ""))
    .replace(/[^a-z0-9-]/gi, "").toLowerCase();
  if (!slug) return;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var LABEL = { instagram: "Instagram", soundcloud: "SoundCloud", spotify: "Spotify", tiktok: "TikTok", youtube: "YouTube", website: "Website" };
  var ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
    dl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
  };
  var artists = [], tracks = [], audio = null, playing = -1;

  // The page's own accent (show pages set --hot), else T.O.F.T.U. purple.
  var css = document.createElement("style");
  css.textContent =
    ".lu-a{all:unset;cursor:pointer;border-bottom:1px dotted currentColor}.lu-a:hover,.lu-a:focus-visible{opacity:.8;outline:none}" +
    ".lu-bg{--lu:var(--hot,#ff5a1f);position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;align-items:flex-end;justify-content:center}" +
    "@media(min-width:640px){.lu-bg{align-items:center;padding:20px}}" +
    ".lu-card{position:relative;width:100%;max-width:420px;max-height:92vh;overflow:auto;overscroll-behavior:contain;background:#000;color:#f2efe9;border-top:3px solid var(--lu);font:15px/1.5 var(--text,system-ui,sans-serif)}" +
    "@media(min-width:640px){.lu-card{border:1px solid #fff;border-top:3px solid var(--lu);box-shadow:8px 8px 0 var(--lu)}}" +
    ".lu-hero{position:relative;aspect-ratio:4/5;background:#111;overflow:hidden}" +
    ".lu-hero img{width:100%;height:100%;object-fit:cover;display:block;filter:contrast(1.08) saturate(.9)}" +
    ".lu-hero:after{content:'';position:absolute;inset:auto 0 0;height:40%;background:linear-gradient(transparent,#000)}" +
    ".lu-hero.np{aspect-ratio:auto;height:28px;background:none}.lu-hero.np:after{display:none}" +
    ".lu-name{position:relative;z-index:1;margin-top:-58px;padding:0 18px}" +
    ".lu-hero.np+.lu-name{margin-top:0}" +
    ".lu-name h3{margin:0;font-family:var(--disp,Impact,sans-serif);font-weight:400;font-size:clamp(46px,14vw,64px);line-height:.88;text-transform:uppercase;letter-spacing:-.005em;word-break:break-word}" +
    ".lu-meta{margin-top:10px;font:12px/1.4 var(--mono,ui-monospace,monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--lu)}" +
    ".lu-body{padding:14px 18px 22px}" +
    ".lu-bio{margin:0 0 18px;white-space:pre-line;color:#cfc9c0}" +
    ".lu-tracks{border-top:1px solid #333;margin:0 0 18px}" +
    ".lu-t{display:grid;grid-template-columns:22px 44px 1fr auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #333}" +
    ".lu-n{font:12px var(--mono,ui-monospace,monospace);color:#777}.lu-t.on .lu-n{color:var(--lu)}" +
    ".lu-cv{position:relative;width:44px;height:44px;padding:0;border:0;cursor:pointer;background:#1a1a1a center/cover;color:#fff}" +
    ".lu-cv i{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)}.lu-cv svg{width:20px;height:20px}" +
    ".lu-t.on .lu-cv i{background:color-mix(in srgb,var(--lu) 55%,transparent)}" +
    ".lu-tt{min-width:0}.lu-tt b{display:block;font-weight:600;font-size:15px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".lu-tt small{display:none}" +
    ".lu-bar{height:2px;background:#222;margin-top:6px}.lu-bar i{display:block;height:100%;width:0;background:var(--lu)}" +
    ".lu-dl{display:flex;align-items:center;gap:3px;color:#aaa;text-decoration:none;font:11px var(--mono,ui-monospace,monospace);text-transform:uppercase;letter-spacing:.06em}.lu-dl:hover{color:#fff}.lu-dl svg{width:14px;height:14px}" +
    ".lu-links{display:flex;flex-wrap:wrap;gap:6px 18px;font:13px var(--mono,ui-monospace,monospace);text-transform:uppercase;letter-spacing:.04em}" +
    ".lu-links a{color:#f2efe9;text-decoration:underline;text-decoration-color:var(--lu);text-underline-offset:4px;text-decoration-thickness:2px}" +
    ".lu-links a:hover,.lu-links a:focus-visible{color:var(--lu);outline:none}" +
    ".lu-x{position:absolute;top:0;right:0;z-index:2;width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:#000;border:0;color:#fff;cursor:pointer;padding:0}.lu-x svg{width:20px;height:20px}";
  document.head.appendChild(css);

  var norm = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); };
  // A track belongs to an artist when their name appears in its artist line ("Cache Stack", "EKIM x B3RMUDA").
  function tracksFor(name) {
    var n = norm(name); if (!n) return [];
    return tracks.filter(function (t) { return (" " + norm(t.artist) + " ").indexOf(" " + n + " ") >= 0; });
  }

  function stop() { if (audio) { audio.pause(); audio = null; } playing = -1; }
  function paint(card) {
    card.querySelectorAll(".lu-t").forEach(function (row) {
      var on = +row.getAttribute("data-i") === playing;
      row.classList.toggle("on", on);
      row.querySelector(".lu-cv i").innerHTML = on && audio && !audio.paused ? ICON.pause : ICON.play;
      if (!on) row.querySelector(".lu-bar i").style.width = "0";
    });
  }
  function toggle(card, i, list) {
    if (playing === i && audio) { if (audio.paused) audio.play().catch(function () {}); else audio.pause(); paint(card); return; }
    stop();
    // Quiet the music bar (or anything else playing) while a track plays here.
    document.querySelectorAll("audio").forEach(function (a) { try { a.pause(); } catch (e) {} });
    var t = list[i]; playing = i; audio = new Audio(t.audio_url);
    var bar = card.querySelector('.lu-t[data-i="' + i + '"] .lu-bar i');
    audio.addEventListener("timeupdate", function () { if (audio && audio.duration) bar.style.width = (100 * audio.currentTime / audio.duration) + "%"; });
    audio.addEventListener("ended", function () { stop(); paint(card); });
    audio.addEventListener("pause", function () { paint(card); });
    audio.addEventListener("play", function () { paint(card); });
    audio.play().catch(function () { paint(card); });
    paint(card);
  }

  function open(a, color) {
    var list = tracksFor(a.name);
    var bg = document.createElement("div"); bg.className = "lu-bg"; if (color) bg.style.setProperty("--lu", color); bg.setAttribute("role", "dialog"); bg.setAttribute("aria-modal", "true"); bg.setAttribute("aria-label", a.name);
    var tags = [a.hometown, a.genre].filter(Boolean).map(esc).join(" / ");
    var links = Object.keys(LABEL).filter(function (k) { return a.links && /^https:\/\//.test(a.links[k] || ""); })
      .map(function (k) { return '<a href="' + esc(a.links[k]) + '" target="_blank" rel="noopener nofollow">' + LABEL[k] + "</a>"; }).join("");
    var rows = list.map(function (t, i) {
      return '<div class="lu-t" data-i="' + i + '"><span class="lu-n">' + (i < 9 ? "0" : "") + (i + 1) + "</span>" +
        '<button type="button" class="lu-cv" data-play="' + i + '" aria-label="Play ' + esc(t.title) + '"' + (t.artwork_url ? ' style="background-image:url(\'' + esc(t.artwork_url) + '\')"' : "") + "><i>" + ICON.play + "</i></button>" +
        '<div class="lu-tt"><b>' + esc(t.title) + "</b><small>" + esc(t.artist) + '</small><div class="lu-bar"><i></i></div></div>' +
        (t.downloadable && t.dl ? '<a class="lu-dl" href="/t?d=' + encodeURIComponent(t.dl) + '" aria-label="Free download: ' + esc(t.title) + '">' + ICON.dl + "Free</a>" : "<span></span>") + "</div>";
    }).join("");
    bg.innerHTML = '<div class="lu-card"><button class="lu-x" type="button" aria-label="Close">' + ICON.x + "</button>" +
      '<div class="lu-hero' + (a.photo_url ? "" : " np") + '">' + (a.photo_url ? '<img src="' + esc(a.photo_url) + '" alt="">' : "") + "</div>" +
      '<div class="lu-name"><h3>' + esc(a.name) + "</h3>" + (tags ? '<div class="lu-meta">' + tags + "</div>" : "") + "</div>" +
      '<div class="lu-body">' + (a.bio ? '<p class="lu-bio">' + esc(a.bio) + "</p>" : "") +
      (rows ? '<div class="lu-tracks">' + rows + "</div>" : "") +
      (links ? '<div class="lu-links">' + links + "</div>" : "") + "</div></div>";
    var card = bg.querySelector(".lu-card");
    var close = function () { stop(); bg.remove(); document.removeEventListener("keydown", key); document.documentElement.style.overflow = ""; };
    var key = function (e) { if (e.key === "Escape") close(); };
    bg.addEventListener("click", function (e) {
      if (e.target === bg || e.target.closest(".lu-x")) return close();
      var p = e.target.closest("[data-play]"); if (p) toggle(card, +p.getAttribute("data-play"), list);
    });
    document.addEventListener("keydown", key);
    document.documentElement.style.overflow = "hidden";
    document.body.appendChild(bg); bg.querySelector(".lu-x").focus();
  }

  // The color of the night an artist plays: the night's own color on show pages (--nc), else the
  // color of that night's heading (T.O.F.T.U.: orange Friday, purple Saturday).
  function dayColor(el) {
    var n = el && el.closest(".night"); if (!n) return "";
    var nc = getComputedStyle(n).getPropertyValue("--nc").trim(); if (nc) return nc;
    var h = n.querySelector("h3"); return h ? getComputedStyle(h).color : "";
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
        if (m) { html += '<button type="button" class="lu-a" data-lu-i="' + artists.indexOf(m) + '" data-lu-c="' + esc(dayColor(li)) + '">' + esc(text.substr(i, m.name.length)) + "</button>"; i += m.name.length; hit = true; }
        else { html += esc(text[i]); i++; }
      }
      li.setAttribute("data-lu", "1");
      if (!hit) return;
      var span = document.createElement("span"); span.innerHTML = html; li.replaceChild(span, t);
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".lu-a"); if (!b) return;
    var a = artists[+b.getAttribute("data-lu-i")]; if (a) { e.preventDefault(); open(a, b.getAttribute("data-lu-c")); }
  });

  // Names on the public lineup right now (so a held-back headliner never gets a card from its tracks).
  function lineupNames() {
    var out = [];
    document.querySelectorAll("#nights li, .s-nights li").forEach(function (li) {
      (li.firstChild && li.firstChild.nodeType === 3 ? li.firstChild.nodeValue : li.textContent).split(/\s+(?:b2b|x|&|vs\.?)\s+/i).forEach(function (s) { s = s.trim(); if (s && !/^(headliner tba|special guest)$/i.test(s)) out.push(s); });
    });
    return out;
  }
  function start() {
    // Artists with tracks but no profile get a card too, under the name the lineup uses.
    lineupNames().forEach(function (n) {
      if (artists.some(function (a) { return norm(a.name) === norm(n); })) return;
      if (tracksFor(n).length) artists.push({ name: n });
    });
    if (!artists.length) return;
    mark();
    // The lineup is drawn after the page loads (and redrawn on updates), so keep watching for it.
    new MutationObserver(function () { mark(); }).observe(document.body, { childList: true, subtree: true });
  }
  var getJson = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }); };
  Promise.all([getJson(FN + "/artist?a=lineup&e=" + encodeURIComponent(slug)), getJson(FN + "/playlist?show=" + encodeURIComponent(slug))]).then(function (r) {
    artists = (r[0].artists || []).filter(function (a) { return a && a.name; });
    tracks = (r[1].tracks || []).filter(function (t) { return t && t.audio_url && t.title; });
    // The lineup may not be drawn yet; wait for it once before matching names to tracks.
    if (document.querySelector("#nights li, .s-nights li")) start();
    else { var mo = new MutationObserver(function () { if (document.querySelector("#nights li, .s-nights li")) { mo.disconnect(); start(); } }); mo.observe(document.body, { childList: true, subtree: true }); }
  });
})();
