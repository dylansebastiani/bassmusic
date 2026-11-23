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
    "@media (max-width:560px){.sbx-time,.sbx-prev{display:none}.sbx-dl{padding:9px 9px;font-size:10px}.sbx-art{width:38px;height:38px}}";
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
    if (st.mini) { el.classList.add("mini"); $(".sbx-min").innerHTML = I.max; $(".sbx-min").setAttribute("aria-label", "Expand player"); }

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
  // A show track's free download: members get the file; everyone else joins first (email first, like every other track).
  function showDownload(k) {
    var key = null; try { key = localStorage.getItem("stack_member"); } catch (e) {}
    if (!key) { location.href = "/?src=dl#fans"; return; }
    getJson(FN + "/playlist?a=dl&id=" + encodeURIComponent(k.dl) + "&t=" + encodeURIComponent(key)).then(function (r) { location.href = r.url || "/?src=dl#fans"; });
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
