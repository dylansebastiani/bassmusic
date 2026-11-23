/* The music bar at the bottom of every public page. Anyone can stream; Download sends
   people to /t?c=CODE, which unlocks the track into their collection (email first, like
   every other track on the site). It remembers the song and spot between pages. */
(function () {
  if (window.__sbxPlayer) return; window.__sbxPlayer = 1;
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1";
  if (!C.supabaseUrl || /example\.supabase\.co/.test(C.supabaseUrl)) return;
  var KEY = "sbx_player", st = {};
  try { st = JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch (e) { st = {}; }
  var tracks = [], i = 0, refetched = false;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var fmt = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); };

  var css = ".sbx{position:fixed;left:0;right:0;bottom:0;z-index:40;background:rgba(5,5,5,.96);border-top:1px solid #2D1052;color:#E7E0F0;font:13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}" +
    ".sbx-in{max-width:980px;margin:0 auto;display:flex;align-items:center;gap:10px}" +
    ".sbx-art{width:42px;height:42px;flex:none;background:#2D1052 center/cover;border:1px solid #2D1052}" +
    ".sbx-meta{flex:1;min-width:0}.sbx-t{font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sbx-a{color:#B5A1C8;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".sbx-bar{position:relative;height:14px;margin-top:4px;cursor:pointer;touch-action:none}.sbx-bar:before{content:'';position:absolute;left:0;right:0;top:6px;height:2px;background:#2D1052}.sbx-fill{position:absolute;left:0;top:6px;height:2px;background:#FF5A1F;width:0}" +
    ".sbx-time{font:11px 'Space Mono','Courier New',monospace;color:#8E84A0;flex:none;width:76px;text-align:right}" +
    ".sbx button{background:none;border:0;color:#fff;cursor:pointer;padding:6px;line-height:0;flex:none}.sbx button:focus-visible,.sbx a:focus-visible{outline:2px solid #AA6EFF;outline-offset:2px}" +
    ".sbx .sbx-play{width:40px;height:40px;border-radius:50%;background:#FF5A1F;color:#050505;display:flex;align-items:center;justify-content:center;padding:0}" +
    ".sbx-dl{flex:none;background:#fff;color:#050505;text-decoration:none;font:400 11px/1 'Bungee','Arial Black',Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:10px 12px;white-space:nowrap}" +
    ".sbx-dl:hover{background:#FF5A1F}.sbx-min{color:#8E84A0!important}" +
    ".sbx.mini .sbx-meta,.sbx.mini .sbx-time,.sbx.mini .sbx-skip,.sbx.mini .sbx-dl{display:none}.sbx.mini{left:auto;right:12px;bottom:12px;border:1px solid #2D1052;padding:6px}" +
    "@media (max-width:560px){.sbx-time,.sbx-prev{display:none}.sbx-dl{padding:9px 9px;font-size:10px}.sbx-art{width:38px;height:38px}}" +
    // download screen
    ".sbx-gate{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.8);display:flex;align-items:flex-end;justify-content:center;padding:12px}" +
    "@media(min-width:640px){.sbx-gate{align-items:center}}" +
    ".sbx-gcard{position:relative;width:100%;max-width:400px;background:#0b0712;border:1px solid #2D1052;color:#E7E0F0;padding:20px 18px calc(18px + env(safe-area-inset-bottom,0px));font:15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}" +
    ".sbx-gx{position:absolute;top:6px;right:8px;background:none;border:0;color:#B5A1C8;font-size:28px;line-height:1;cursor:pointer;padding:6px}" +
    ".sbx-gh{display:flex;gap:12px;align-items:center;margin:0 28px 14px 0}.sbx-gh img{width:56px;height:56px;object-fit:cover;flex:none}.sbx-gh b{display:block;color:#fff;font-size:17px}.sbx-gh span{font-size:12px;color:#B5A1C8}" +
    ".sbx-gf{margin:0 0 14px}.sbx-gf span{display:block;font:700 11px 'Space Mono','Courier New',monospace;letter-spacing:.1em;text-transform:uppercase;color:#B5A1C8;margin-bottom:6px}" +
    ".sbx-gf div{display:flex;flex-wrap:wrap;gap:6px}.sbx-gf a{border:1px solid #AA6EFF;color:#fff;text-decoration:none;padding:9px 12px;font:700 12px 'Space Mono','Courier New',monospace;text-transform:uppercase;letter-spacing:.06em}" +
    ".sbx-gform label{display:block;font:700 11px 'Space Mono','Courier New',monospace;letter-spacing:.1em;text-transform:uppercase;color:#B5A1C8;margin:0 0 10px}" +
    ".sbx-gform input{display:block;width:100%;box-sizing:border-box;margin-top:5px;background:#050505;border:1px solid #2D1052;color:#fff;font:16px -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:12px;border-radius:0;outline:none;text-transform:none;letter-spacing:0}" +
    ".sbx-gform input:focus{border-color:#FF5A1F}.sbx-g2{display:grid;grid-template-columns:3fr 2fr;gap:10px}" +
    ".sbx-gbtn{display:block;width:100%;background:#FF5A1F;color:#050505;border:0;padding:16px;font:400 16px/1 'Bungee','Arial Black',Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;margin-top:4px}" +
    ".sbx-gbtn:disabled{opacity:.7}.sbx-gmsg{min-height:1em;margin:8px 0 0;font-size:13px;color:#fff}.sbx-gfine{margin:6px 0 0;font-size:11px;color:#8E84A0}" +
    ".sbx-gnot{background:none;border:0;color:#B5A1C8;text-decoration:underline;cursor:pointer;font:inherit;padding:0}";
  var I = {
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>',
    prev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2.5v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.5 5H18v14h-2.5zM4 5v14l11-7z"/></svg>',
    min: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    max: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  };

  var audio = new Audio(); audio.preload = "metadata";
  var el, $ = function (c) { return el.querySelector(c); };

  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify({ slug: tracks[i] && tracks[i].slug, t: audio.currentTime || 0, playing: !audio.paused, mini: el.classList.contains("mini") })); } catch (e) {}
  }
  function render() {
    var k = tracks[i];
    $(".sbx-t").textContent = k.title;
    $(".sbx-a").textContent = (k.artist || "Subduction") + "  ·  " + (i + 1) + "/" + tracks.length;
    // A 96px thumbnail ships with the site; the full-size cover from storage is only the fallback.
    var art = $(".sbx-art"), own = /^show:/.test(k.slug || ""), thumb = "/assets/covers/" + encodeURIComponent(k.slug || "") + ".webp";
    var probe = new Image();
    probe.onload = function () { art.style.backgroundImage = 'url("' + thumb + '")'; };
    probe.onerror = function () { art.style.backgroundImage = k.artwork_url ? 'url("' + k.artwork_url.replace(/"/g, "%22") + '")' : ""; };
    if (k.slug && !own) probe.src = thumb; else probe.onerror();
    var dl = $(".sbx-dl");
    dl.hidden = !k.downloadable || !(k.code || k.dl);
    dl.href = "/t?c=" + encodeURIComponent(k.code || "");
    dl.setAttribute("aria-label", "Download " + k.title + " free");
  }
  function load(n, at, autoplay) {
    i = (n + tracks.length) % tracks.length;
    audio.src = tracks[i].audio_url;
    if (at) audio.addEventListener("loadedmetadata", function once() { audio.removeEventListener("loadedmetadata", once); try { audio.currentTime = at; } catch (e) {} });
    render(); tick();
    if (autoplay) play();
  }
  function play() { audio.play().catch(function () { sync(); }); }
  function sync() {
    var p = $(".sbx-play"); p.innerHTML = audio.paused ? I.play : I.pause;
    p.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
  }
  function tick() {
    var d = audio.duration || 0;
    $(".sbx-fill").style.width = (d ? (audio.currentTime / d) * 100 : 0) + "%";
    $(".sbx-time").textContent = fmt(audio.currentTime) + " / " + (d ? fmt(d) : "-:--");
  }
  function placeAboveTabs() {
    var tabs = document.querySelector(".tabs");
    var h = tabs && getComputedStyle(tabs).display !== "none" ? tabs.getBoundingClientRect().height : 0;
    el.style.bottom = el.classList.contains("mini") ? (h + 12) + "px" : h + "px";
    document.body.style.paddingBottom = el.classList.contains("mini") ? "" : (el.getBoundingClientRect().height + h) + "px";
  }

  function mount() {
    var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
    el = document.createElement("div"); el.className = "sbx"; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Music player");
    el.innerHTML = '<div class="sbx-in">' +
      '<div class="sbx-art" aria-hidden="true"></div>' +
      '<button type="button" class="sbx-skip sbx-prev" aria-label="Previous track">' + I.prev + "</button>" +
      '<button type="button" class="sbx-play" aria-label="Play">' + I.play + "</button>" +
      '<button type="button" class="sbx-skip sbx-next" aria-label="Next track">' + I.next + "</button>" +
      '<div class="sbx-meta"><div class="sbx-t"></div><div class="sbx-a"></div><div class="sbx-bar" role="slider" tabindex="0" aria-label="Seek"><div class="sbx-fill"></div></div></div>' +
      '<div class="sbx-time">0:00 / -:--</div>' +
      '<a class="sbx-dl" href="#">Download</a>' +
      '<button type="button" class="sbx-min" aria-label="Minimize player">' + I.min + "</button></div>";
    document.body.appendChild(el);
    // On the homepage and the artist page the bar starts tucked away, so it never covers the page's own buttons.
    // Once someone opens or closes it, that choice is remembered.
    var tucked = /^\/(index\.html|artists(\.html)?)?$/.test(location.pathname);
    if (st.mini || (st.mini === undefined && tucked)) { el.classList.add("mini"); $(".sbx-min").innerHTML = I.max; $(".sbx-min").setAttribute("aria-label", "Expand player"); }

    $(".sbx-play").addEventListener("click", function () { if (audio.paused) play(); else audio.pause(); });
    $(".sbx-prev").addEventListener("click", function () { load(audio.currentTime > 3 ? i : i - 1, 0, true); });
    $(".sbx-next").addEventListener("click", function () { load(i + 1, 0, true); });
    $(".sbx-min").addEventListener("click", function () {
      var m = el.classList.toggle("mini");
      this.innerHTML = m ? I.max : I.min; this.setAttribute("aria-label", m ? "Expand player" : "Minimize player");
      placeAboveTabs(); save();
    });
    var bar = $(".sbx-bar");
    function seek(e) { var r = bar.getBoundingClientRect(), x = (e.clientX - r.left) / r.width; if (audio.duration) audio.currentTime = Math.max(0, Math.min(1, x)) * audio.duration; tick(); }
    bar.addEventListener("pointerdown", function (e) { seek(e); bar.setPointerCapture(e.pointerId); bar.onpointermove = seek; });
    bar.addEventListener("pointerup", function () { bar.onpointermove = null; save(); });
    bar.addEventListener("keydown", function (e) { if (e.key === "ArrowRight") audio.currentTime += 5; if (e.key === "ArrowLeft") audio.currentTime -= 5; });
    $(".sbx-dl").addEventListener("click", function (e) { save(); var k = tracks[i]; if (k && k.dl) { e.preventDefault(); showDownload(k); } });

    audio.addEventListener("play", function () { sync(); save(); });
    audio.addEventListener("pause", function () { sync(); save(); });
    audio.addEventListener("timeupdate", tick);
    audio.addEventListener("ended", function () { load(i + 1, 0, true); });
    audio.addEventListener("error", function () {
      // Stream links last an hour; a tab left open longer gets fresh ones once.
      if (refetched) return; refetched = true;
      var at = audio.currentTime, was = !audio.paused || st.playing;
      var cur = tracks[i] && tracks[i].slug;
      fetchList().then(function (list) { if (!list.length) return; var n = 0; for (var k = 0; k < list.length; k++) if (list[k].slug === cur) n = k; tracks = list; load(n, at, was); });
    });
    // Another player on the page (the collection's track cards) pauses this one.
    document.addEventListener("play", function (e) { if (e.target !== audio && e.target.tagName === "AUDIO") audio.pause(); }, true);
    window.addEventListener("pagehide", save);
    window.addEventListener("resize", placeAboveTabs);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("nexttrack", function () { load(i + 1, 0, true); });
      navigator.mediaSession.setActionHandler("previoustrack", function () { load(i - 1, 0, true); });
      audio.addEventListener("play", function () {
        var k = tracks[i]; try { navigator.mediaSession.metadata = new MediaMetadata({ title: k.title, artist: k.artist || "Subduction", album: "Subduction", artwork: k.artwork_url ? [{ src: k.artwork_url, sizes: "512x512" }] : [] }); } catch (e) {}
      });
    }
  }
  // A show's page plays that show's own playlist when its promoter uploaded one; everywhere else
  // (and on shows without one) it plays Subduction's tracks. Either way the order is a fresh shuffle.
  var qs = new URLSearchParams(location.search), path = location.pathname.replace(/\/+$/, "");
  var showSlug = window.__SHOW_SLUG || (/(^|\/)show(\.html)?$/.test(path) ? qs.get("e") || "" : /(^|\/)(tickets(\.html)?|underground)$/.test(path) ? qs.get("e") || "underground" : "");
  showSlug = showSlug.replace(/[^a-z0-9-]/gi, "").toLowerCase();
  function getJson(url) { return fetch(url).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }); }
  function shuffle(list) {
    for (var a = list.length - 1; a > 0; a--) { var b = Math.floor(Math.random() * (a + 1)), t = list[a]; list[a] = list[b]; list[b] = t; }
    return list;
  }
  function fetchList() {
    var own = showSlug ? getJson(FN + "/playlist?show=" + encodeURIComponent(showSlug)) : Promise.resolve({});
    return own.then(function (o) {
      var mine = o.tracks || [];
      // The show's own tracks only, when its promoter uploaded a playlist. Otherwise Subduction's tracks, plus anything the show's artists added.
      if (mine.length && !o.mix) return mine;
      return getJson(FN + "/track?player=1").then(function (c) { return mine.concat(c.tracks || []); });
    }).then(shuffle);
  }
  // An artist's free download: the fan gives name, email, phone and ZIP once (the phone fills it in),
  // and that goes to the artist and the promoter. After that their phone remembers them: one tap.
  var FANKEY = "sbx_fan", LINKS = { instagram: "Instagram", soundcloud: "SoundCloud", spotify: "Spotify", tiktok: "TikTok", youtube: "YouTube", website: "Website" };
  function showDownload(k) {
    var fan = null; try { fan = JSON.parse(localStorage.getItem(FANKEY) || "null"); } catch (e) {}
    var follow = Object.keys(LINKS).filter(function (x) { return k.links && /^https:\/\//.test(k.links[x] || ""); })
      .map(function (x) { return '<a href="' + esc(k.links[x]) + '" target="_blank" rel="noopener nofollow">' + LINKS[x] + "</a>"; }).join("");
    var bg = document.createElement("div"); bg.className = "sbx-gate"; bg.setAttribute("role", "dialog"); bg.setAttribute("aria-modal", "true"); bg.setAttribute("aria-label", "Download " + k.title);
    var head = '<button type="button" class="sbx-gx" aria-label="Close">&times;</button><div class="sbx-gh">' +
      (k.artwork_url ? '<img src="' + esc(k.artwork_url) + '" alt="">' : "") + '<div><b>' + esc(k.title) + "</b><span>" + esc(k.artist || "") + " · free download</span></div></div>";
    var followBox = follow ? '<div class="sbx-gf"><span>Follow ' + esc(k.artist || "the artist") + "</span><div>" + follow + "</div></div>" : "";
    var form = '<form class="sbx-gform" novalidate>' +
      '<label>Name<input name="name" autocomplete="name" required maxlength="80" value="' + esc(fan && fan.name || "") + '"></label>' +
      '<label>Email<input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required maxlength="254" value="' + esc(fan && fan.email || "") + '"></label>' +
      '<div class="sbx-g2"><label>Phone<input name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" value="' + esc(fan && fan.phone || "") + '"></label>' +
      '<label>ZIP<input name="zip" inputmode="numeric" autocomplete="postal-code" required maxlength="10" value="' + esc(fan && fan.zip || "") + '"></label></div>' +
      '<button type="submit" class="sbx-gbtn">Download</button><p class="sbx-gmsg" role="status"></p>' +
      '<p class="sbx-gfine">Your info goes to ' + esc(k.artist || "the artist") + " and the show's promoter so they can tell you about new music and shows.</p></form>";
    var quick = fan ? '<div class="sbx-gq"><button type="button" class="sbx-gbtn sbx-go">Download</button><p class="sbx-gmsg" role="status"></p>' +
      '<p class="sbx-gfine">As ' + esc(fan.name) + " · " + esc(fan.email) + ' &nbsp;<button type="button" class="sbx-gnot">Not you?</button></p></div>' : "";
    bg.innerHTML = '<div class="sbx-gcard">' + head + followBox + (fan ? quick : form) + "</div>";
    document.body.appendChild(bg);
    var close = function () { bg.remove(); };
    bg.addEventListener("click", function (e) { if (e.target === bg || e.target.closest(".sbx-gx")) close(); });
    function send(info, btn) {
      var msg = bg.querySelector(".sbx-gmsg"); btn.disabled = true; btn.textContent = "Getting it...";
      fetch(FN + "/playlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: "gate", id: k.dl, name: info.name, email: info.email, phone: info.phone, zip: info.zip }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong. Try again."); return j; }); })
        .then(function (j) {
          try { localStorage.setItem(FANKEY, JSON.stringify(info)); } catch (e) {}
          btn.textContent = "Downloading ✓"; msg.textContent = follow ? "Enjoy it. Give them a follow while you're here." : "Enjoy it.";
          location.href = j.url;
        })
        .catch(function (err) { btn.disabled = false; btn.textContent = "Download"; msg.textContent = err.message; if (/name|email|phone|ZIP/i.test(err.message) && fan) { try { localStorage.removeItem(FANKEY); } catch (e) {} } });
    }
    if (fan) {
      bg.querySelector(".sbx-go").addEventListener("click", function () { send(fan, this); });
      bg.querySelector(".sbx-gnot").addEventListener("click", function () { try { localStorage.removeItem(FANKEY); } catch (e) {} close(); showDownload(k); });
      bg.querySelector(".sbx-go").focus();
    } else {
      var f = bg.querySelector("form"), F = function (n) { return f.elements[n]; };
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var info = { name: F("name").value.trim(), email: F("email").value.trim().toLowerCase(), phone: F("phone").value.trim(), zip: F("zip").value.trim() };
        var m = bg.querySelector(".sbx-gmsg");
        if (info.name.length < 2) { m.textContent = "Add your name."; F("name").focus(); return; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(info.email)) { m.textContent = "That email doesn't look right."; F("email").focus(); return; }
        if (info.phone.replace(/\D/g, "").length < 10) { m.textContent = "Add your phone number."; F("phone").focus(); return; }
        if (info.zip.length < 3) { m.textContent = "Add your ZIP code."; F("zip").focus(); return; }
        send(info, f.querySelector(".sbx-gbtn"));
      });
      (F("name").value ? f.querySelector(".sbx-gbtn") : F("name")).focus();
    }
  }

  fetchList().then(function (list) {
    if (!list.length) return;
    tracks = list;
    mount();
    var n = 0; for (var k = 0; k < list.length; k++) if (list[k].slug === st.slug) n = k;
    // Coming from another page while it was playing: pick up where it left off.
    // If the browser won't start sound without a tap, it waits on the play button.
    load(n, st.slug ? st.t : 0, !!st.playing);
    sync();
    requestAnimationFrame(placeAboveTabs);
  });
})();
