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
  // Social logos from Simple Icons (CC0, simpleicons.org); the globe is ours, for a website link.
  var SOCIAL = {"instagram": "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077", "soundcloud": "M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147.272.272 0 0 1-.542 0 27.955 27.955 0 0 1 0-7.147.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z", "spotify": "M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z", "tiktok": "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z", "youtube": "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z", "website": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.7 15.7 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a8.2 8.2 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.07 16zm2.95-8H5.07a7.99 7.99 0 0 1 4.33-3.56A15.7 15.7 0 0 0 8.02 8zM12 19.96A14.1 14.1 0 0 1 10.09 16h3.82A14.1 14.1 0 0 1 12 19.96zM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14a16.5 16.5 0 0 0 0-4h3.38a8.2 8.2 0 0 1 0 4h-3.38z"};
  var artists = [], tracks = [], audio = null, playing = -1;

  // The page's own accent (show pages set --hot), else T.O.F.T.U. purple.
  var css = document.createElement("style");
  css.textContent =
    ".lu-a{all:unset;cursor:pointer}.lu-a:after{content:'\\203A';display:inline-block;margin-left:.3em;color:var(--luc,currentColor);opacity:.85;font-weight:700;transform:translateY(-.02em)}.lu-a:hover,.lu-a:focus-visible{opacity:.8;outline:none}" +
    ".lu-bg{--lu:var(--hot,#ff5a1f);position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;align-items:flex-end;justify-content:center}" +
    "@media(min-width:640px){.lu-bg{align-items:center;padding:20px}}" +
    ".lu-card{position:relative;width:100%;max-width:420px;max-height:92vh;overflow:auto;overscroll-behavior:contain;background:#000;color:#f2efe9;border-top:3px solid var(--lu);font:15px/1.5 var(--text,system-ui,sans-serif)}" +
    "@media(min-width:640px){.lu-card{border:1px solid #fff;border-top:3px solid var(--lu);box-shadow:8px 8px 0 var(--lu)}}" +
    ".lu-hero{position:relative;aspect-ratio:1;background:#111;overflow:hidden}" +
    ".lu-hero img{width:100%;height:100%;object-fit:cover;object-position:50% 25%;display:block;filter:contrast(1.1) saturate(.82) brightness(.95)}" +
    ".lu-hero:after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.25) 0,transparent 22%,transparent 50%,rgba(0,0,0,.75) 82%,#000)}" +
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
    ".lu-links{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 10px;margin-top:4px}" +
    ".lu-links a{display:flex;align-items:center;justify-content:center;width:46px;height:46px;color:#f2efe9;transition:color .15s,transform .15s}" +
    ".lu-links a svg{width:24px;height:24px}" +
    ".lu-links a:hover,.lu-links a:focus-visible{color:var(--lu);transform:translateY(-2px);outline:none}" +
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

  // Every artist gets the same square frame. Flat black or white bars (phone screenshots, letterboxing)
  // are trimmed first so the photo, not the bars, fills it; tall photos are cropped from the upper part.
  var fitted = {};
  function fitPhoto(url, hero) {
    var img = hero.querySelector("img");
    var apply = function (f) { if (f.src) img.src = f.src; };
    if (fitted[url]) return apply(fitted[url]);
    var im = new Image(); im.crossOrigin = "anonymous";
    im.onload = function () {
      var w = im.naturalWidth, h = im.naturalHeight, box = { x: 0, y: 0, w: w, h: h }, src = "";
      try {
        var S = 200, sc = Math.min(1, S / Math.max(w, h)), cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
        var c = document.createElement("canvas"); c.width = cw; c.height = ch; var x = c.getContext("2d"); x.drawImage(im, 0, 0, cw, ch);
        var d = x.getImageData(0, 0, cw, ch).data;
        var flat = function (y0, y1, x0, x1) { // a row/column strip that's all near-black or all near-white
          var lo = 255, hi = 0;
          for (var yy = y0; yy < y1; yy++) for (var xx = x0; xx < x1; xx++) { var k = (yy * cw + xx) * 4, v = (d[k] + d[k + 1] + d[k + 2]) / 3; if (v < lo) lo = v; if (v > hi) hi = v; }
          return (hi < 28) || (lo > 235);
        };
        var t = 0, b = ch, l = 0, r = cw;
        while (t < ch * 0.4 && flat(t, t + 1, 0, cw)) t++;
        while (b > ch * 0.6 && flat(b - 1, b, 0, cw)) b--;
        while (l < cw * 0.4 && flat(t, b, l, l + 1)) l++;
        while (r > cw * 0.6 && flat(t, b, r - 1, r)) r--;
        if (t > 2 || ch - b > 2 || l > 2 || cw - r > 2) {
          box = { x: Math.round(l / sc), y: Math.round(t / sc), w: Math.round((r - l) / sc), h: Math.round((b - t) / sc) };
          var o = document.createElement("canvas"), m = Math.min(1, 1400 / Math.max(box.w, box.h));
          o.width = Math.round(box.w * m); o.height = Math.round(box.h * m);
          o.getContext("2d").drawImage(im, box.x, box.y, box.w, box.h, 0, 0, o.width, o.height);
          src = o.toDataURL("image/jpeg", 0.9);
        }
      } catch (e) { box = { x: 0, y: 0, w: w, h: h }; src = ""; }
      var ratio = Math.min(1.5, Math.max(0.8, box.w / box.h));
      fitted[url] = { r: String(ratio), src: src }; apply(fitted[url]);
    };
    im.src = url;
  }
  function open(a, color) {
    var list = tracksFor(a.name);
    var bg = document.createElement("div"); bg.className = "lu-bg"; if (color) bg.style.setProperty("--lu", color); bg.setAttribute("role", "dialog"); bg.setAttribute("aria-modal", "true"); bg.setAttribute("aria-label", a.name);
    var tags = [a.hometown, a.genre].filter(Boolean).map(esc).join(" / ");
    var links = Object.keys(LABEL).filter(function (k) { return a.links && /^https:\/\//.test(a.links[k] || ""); })
      .map(function (k) { return '<a href="' + esc(a.links[k]) + '" target="_blank" rel="noopener nofollow" aria-label="' + esc(a.name) + " on " + LABEL[k] + '" title="' + LABEL[k] + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + SOCIAL[k] + '" fill="currentColor"/></svg></a>'; }).join("");
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
    if (a.photo_url) fitPhoto(a.photo_url, bg.querySelector(".lu-hero"));
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
        if (m) { html += '<button type="button" class="lu-a" data-lu-i="' + artists.indexOf(m) + '" data-lu-c="' + esc(dayColor(li)) + '" style="--luc:' + esc(dayColor(li)) + '">' + esc(text.substr(i, m.name.length)) + "</button>"; i += m.name.length; hit = true; }
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
