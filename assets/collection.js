/* The member app: Collection and Events. Coupons and Shop tabs appear only once there is something in them.
   Signed in by the key this phone already holds. */
(function () {
  var S = window.Stack, C = S.C, $ = function (id) { return document.getElementById(id); }, esc = S.esc;
  var TABS = ["collection", "coupons", "events", "shop"];
  var KINDS = { show: "Show", popup: "Pop-up", drop: "Drop", other: "Event" };
  var t = S.token(), data = null, refresher = null;
  S.pageview("/collection");

  $("signout").addEventListener("click", function () { S.forget(); location.replace("./"); });

  // ---------- tabs ----------
  function visible(name) { return !$("tab-" + name).hidden; }
  function show(name) {
    if (TABS.indexOf(name) < 0 || !visible(name)) name = "collection";
    TABS.forEach(function (n) {
      $("p-" + n).hidden = n !== name;
      $("tab-" + n).setAttribute("aria-selected", n === name ? "true" : "false");
    });
    try { history.replaceState(null, "", "#" + name); } catch (e) {}
    scrollTo(0, 0);
  }
  $("tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) show(b.getAttribute("data-tab")); });

  // ---------- signed out: the same email box as everywhere ----------
  if (!t) {
    $("signin").hidden = false;
    if (S.q.get("pending")) $("signin").querySelector(".lead").textContent = "No signal right now. Your signup is saved on this phone and finishes the next time you open the site with a connection.";
    window.Join.mount($("join"), { cta: "Open my collection", hint: "New here? Same box, you're in. Already in? We'll email you a code.", onDone: function () { location.reload(); } });
    return;
  }

  // ---------- a player that looks like the site, not the browser ----------
  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  function player(k) {
    return '<div class="player"><button type="button" class="play" aria-label="Play"></button>' +
      '<div class="bar" role="slider" aria-label="Position"><i></i></div><span class="time">0:00</span>' +
      '<audio preload="none" src="' + esc(k.audio_url) + '"></audio></div>';
  }
  function trackCard(k, big) {
    return '<article class="card track' + (big ? " big new" : "") + '" data-slug="' + esc(k.slug) + '">' +
      (k.artwork_url ? '<img class="cover" src="' + esc(k.artwork_url) + '" alt="" loading="lazy">' : '<div class="cover blank"></div>') +
      "<div>" + (big ? '<span class="chip">' + (k.audio_url ? "Unlocked" : "Yours once you fill this in") + '</span> ' : "") + "<h3>" + esc(k.title) + "</h3>" +
      (k.artist ? '<div class="by">' + esc(k.artist) + "</div>" : "") + "</div>" +
      (k.audio_url ? player(k) : "") +
      (k.download_url ? '<a class="btn ghost dl" href="' + esc(k.download_url) + '" rel="noopener">Download WAV</a>' : "") +
      "</article>";
  }
  var consentText = S.fill ? S.fill(C.smsConsentText, { LABEL_NAME: C.labelName }) : String(C.smsConsentText || "").replace("{{LABEL_NAME}}", C.labelName || "");
  function fields(d) {
    d = d || {};
    return '<label for="first_name">First name</label><input type="text" id="first_name" autocomplete="given-name" placeholder="first name" value="' + esc(d.first_name || "") + '" required>' +
      '<div class="row2"><div><label for="phone">Phone</label><input type="tel" id="phone" autocomplete="tel" placeholder="phone" value="' + esc(d.phone || "") + '" required></div>' +
      '<div><label for="zip">ZIP</label><input type="text" id="zip" inputmode="numeric" autocomplete="postal-code" placeholder="zip" value="' + esc(d.zip || "") + '" required></div></div>' +
      '<label class="check"><input type="checkbox" id="sms"' + (d.sms_consent ? " checked" : "") + '><span>Text me show alerts and drops<small>' + esc(consentText) + "</small></span></label>";
  }
  // The wall: first name, phone and ZIP open play and download for every track. Asked once.
  function wallForm() {
    return '<form id="wall" class="wall" novalidate>' +
      '<p class="gate">Drop your name, number and ZIP to unlock it. Play it here or download the WAV. One time, then every track opens.</p>' +
      fields() +
      '<label class="check"><input type="checkbox" id="age"><span>' + esc(C.ageText || "I'm 13 or older.") + "</span></label>" +
      '<button type="submit" class="btn" id="wallBtn">Unlock the track</button>' +
      '<div class="msg" id="wallMsg" role="status"></div></form>';
  }
  function infoBox(d) {
    return '<details class="info" id="infoBox"><summary>Your info</summary><form id="infoForm" novalidate>' + fields(d) +
      '<button type="submit" class="btn ghost" id="infoBtn">Save</button><div class="msg" id="infoMsg" role="status"></div></form></details>';
  }
  function friendCard(d) {
    if (!d.referral_code) return "";
    var link = (C.siteUrl || location.origin) + "/?r=" + d.referral_code;
    return '<article class="card friend"><h3>Bring a friend</h3><div class="where">Send them this link. They get the welcome track the moment they\'re in, and you get credit for it.</div>' +
      '<div class="code"><b>' + esc(link.replace(/^https?:\/\//, "")) + '</b><button type="button" data-copy="' + esc(link) + '">Copy</button></div></article>';
  }
  function paintTracks(d) {
    var el = $("p-collection"), fresh = S.q.get("new");
    // The track to show big: the one just scanned, or, while the wall is up, the newest one.
    var focus = fresh ? d.tracks.filter(function (k) { return k.slug === fresh; })[0] : null;
    if (!focus && !d.profile_done && d.tracks.length) focus = d.tracks[0];
    var rest = d.tracks.filter(function (k) { return k !== focus; });
    var html = "";
    if (focus) html += trackCard(focus, true) + (d.profile_done ? "" : wallForm());
    html += '<h2 class="disp">' + (d.first_name ? esc(d.first_name) + "'s " : "My ") + "collection</h2>";
    if (!d.tracks.length) html += '<div class="empty">Nothing here yet. Every track has its own code. Scan one at a show and it lands here.</div>';
    else if (rest.length) html += '<div class="list">' + rest.map(function (k) { return trackCard(k, false); }).join("") + "</div>";
    else if (focus) html += '<div class="empty">That\'s your first one. Scan another code at a show and it lands here too.</div>';
    if (d.profile_done && !d.light) html += '<div class="list extra">' + friendCard(d) + infoBox(d) + "</div>";
    // Signed in from a sticker scan: tracks and shows only. Details need the emailed code.
    if (d.light) html += '<div class="list extra"><div class="empty">Signed in from a sticker. To change your info or get your friend link, <button type="button" class="hint" id="upgrade">sign in with your email code</button>.</div></div>';
    el.innerHTML = html;
    $("n-collection").textContent = d.tracks.length ? "(" + d.tracks.length + ")" : "";

    var w = $("wall");
    if (w) w.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("first_name").value.trim(), phone = $("phone").value.trim(), zip = $("zip").value.trim(), m = $("wallMsg");
      if (!name) return say(m, "Add your first name.", $("first_name"));
      if (phone.replace(/\D/g, "").length < 10) return say(m, "Add your phone number.", $("phone"));
      if (!/^\d{5}(-?\d{4})?$/.test(zip)) return say(m, "Add your ZIP.", $("zip"));
      if (!$("age").checked) return say(m, "Tick the box to confirm you're 13 or older.", $("age"));
      $("wallBtn").disabled = true; m.textContent = "Unlocking...";
      S.api("profile", { t: t, unlock: true, first_name: name, zip: zip, phone: phone, sms_consent: $("sms").checked, age_confirmed: true })
        .then(function () { return load(true); })
        .catch(function (err) { $("wallBtn").disabled = false; m.textContent = err.message || "Couldn't save. Try again."; });
    });
    var up = $("upgrade");
    if (up) up.addEventListener("click", function () { S.forget(); location.replace("/collection.html"); });
    var f = $("infoForm");
    if (f) f.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("first_name").value.trim(), phone = $("phone").value.trim(), zip = $("zip").value.trim(), m = $("infoMsg");
      if (!name) return say(m, "Add your first name.", $("first_name"));
      if (phone.replace(/\D/g, "").length < 10) return say(m, "That phone number looks short.", $("phone"));
      if (!/^\d{5}(-?\d{4})?$/.test(zip)) return say(m, "That ZIP doesn't look right.", $("zip"));
      $("infoBtn").disabled = true; m.textContent = "Saving...";
      S.api("profile", { t: t, first_name: name, zip: zip, phone: phone, sms_consent: $("sms").checked })
        .then(function () { $("infoBtn").disabled = false; m.textContent = "Saved."; data.first_name = name; data.phone = phone; data.zip = zip; data.sms_consent = $("sms").checked; })
        .catch(function (err) { $("infoBtn").disabled = false; m.textContent = err.message || "Couldn't save. Try again."; });
    });
  }
  function say(m, text, field) { m.textContent = text; if (field) field.focus(); }
  function paintCoupons(d) {
    var html = '<h2 class="disp">Coupons</h2>';
    if (!d.coupons.length) html += '<div class="empty">No codes right now. Check back after the next show.</div>';
    else html += '<div class="list">' + d.coupons.map(function (c) {
      var link = S.safeUrl(c.url);
      return '<article class="card"><h3>' + esc(c.title) + "</h3>" + (c.description ? '<div class="where">' + esc(c.description) + "</div>" : "") +
        (c.locked ? '<div class="lock">' + esc(c.need) + " to unlock</div>"
          : '<div class="code"><b>' + esc(c.code) + '</b><button type="button" data-copy="' + esc(c.code) + '">Copy</button></div>') +
        (c.expires_at ? '<div class="when">Ends ' + esc(S.fmtDate(c.expires_at)) + "</div>" : "") +
        (link && !c.locked ? '<a class="btn ghost" href="' + esc(link) + '" rel="noopener" target="_blank">Use it</a>' : "") + "</article>";
    }).join("") + "</div>";
    $("p-coupons").innerHTML = html;
  }
  function paintEvents(d) {
    var html = '<h2 class="disp">Events</h2>';
    if (!d.events.length) html += '<div class="empty">Nothing on the calendar yet. Shows and pop-ups land here first.</div>';
    else html += '<div class="list">' + d.events.map(function (e) {
      var link = S.safeUrl(e.ticket_url), where = [e.venue, e.city].filter(Boolean).join(" · ");
      return '<article class="card"><span class="chip">' + esc(KINDS[e.kind] || "Event") + "</span><h3>" + esc(e.name) + "</h3>" +
        (e.starts_at ? '<div class="when">' + esc(S.fmtDate(e.starts_at, true)) + "</div>" : "") +
        (where ? '<div class="where">' + esc(where) + "</div>" : "") + (e.address ? '<div class="where">' + esc(e.address) + "</div>" : "") +
        (e.description ? "<p>" + esc(e.description) + "</p>" : "") +
        (link ? '<a class="btn ghost" href="' + esc(link) + '" rel="noopener" target="_blank">Tickets / info</a>' : "") + "</article>";
    }).join("") + "</div>";
    $("p-events").innerHTML = html;
  }
  // Tabs with nothing behind them stay hidden, so the page never looks half built.
  function paintTabs(d) {
    $("tab-coupons").hidden = !d.coupons.length;
    $("tab-shop").hidden = !S.safeUrl(C.shopUrl);
    var n = TABS.filter(visible).length;
    $("tabs").style.gridTemplateColumns = "repeat(" + n + ",1fr)";
  }

  // ---------- copy buttons, one player at a time ----------
  $("app").addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]"); if (!b) return;
    var code = b.getAttribute("data-copy");
    function done() { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500); }
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, function () {});
    else { var r = document.createRange(); r.selectNodeContents(b.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); done(); }
  });
  var pc = $("p-collection");
  pc.addEventListener("click", function (e) {
    var play = e.target.closest(".play"), bar = e.target.closest(".bar");
    if (play) {
      var a = play.parentNode.querySelector("audio");
      if (a.paused) { Array.prototype.forEach.call(pc.querySelectorAll("audio"), function (o) { if (o !== a) o.pause(); }); a.play().catch(function () { play.parentNode.querySelector(".time").textContent = "Can't play"; }); }
      else a.pause();
    } else if (bar) {
      var au = bar.parentNode.querySelector("audio"), r = bar.getBoundingClientRect();
      if (au.duration) au.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * au.duration;
    }
  });
  function onMedia(e) {
    var a = e.target; if (a.tagName !== "AUDIO") return;
    var p = a.parentNode, bar = p.querySelector(".bar i"), time = p.querySelector(".time");
    if (e.type === "play") p.classList.add("playing");
    if (e.type === "pause" || e.type === "ended") p.classList.remove("playing");
    if (e.type === "timeupdate" || e.type === "ended" || e.type === "loadedmetadata") {
      var d = a.duration || 0, c = e.type === "ended" ? 0 : a.currentTime;
      bar.style.width = d ? (100 * c / d).toFixed(1) + "%" : "0%";
      time.textContent = d ? fmt(c) + " / " + fmt(d) : fmt(c);
    }
    if (e.type === "error") { time.textContent = "Couldn't load"; p.classList.remove("playing"); }
  }
  ["play", "pause", "ended", "timeupdate", "loadedmetadata", "error"].forEach(function (ev) { pc.addEventListener(ev, onMedia, true); });

  // ---------- load, and keep the 10-minute links fresh ----------
  function load(first) {
    return S.get("collection", { t: t, e: S.q.get("e"), rejoin: S.q.get("rejoin") }).then(function (d) {
      data = d;
      if (first) {
        paintTabs(d); paintTracks(d); paintCoupons(d); paintEvents(d);
        $("app").hidden = false; $("tabs").hidden = false; $("signout").hidden = false;
        show((location.hash || "").slice(1) || "collection");
        if (!refresher) refresher = setInterval(function () { load(false).catch(function () {}); }, 8 * 60000);
      } else {
        // Swap the links in place so a playing track never restarts.
        d.tracks.forEach(function (k) {
          var card = document.querySelector('.track[data-slug="' + k.slug.replace(/"/g, "") + '"]'); if (!card) return;
          var a = card.querySelector("audio"); if (a && k.audio_url && a.paused && !a.currentTime) a.src = k.audio_url;
          var dl = card.querySelector("a.dl"); if (dl && k.download_url) dl.href = k.download_url;
        });
      }
    });
  }
  load(true).catch(function (err) {
    if (err.status === 404) { S.forget(); location.replace("collection.html"); return; }
    $("signin").hidden = false;
    $("signin").innerHTML = '<h1 class="disp">No <em>signal</em></h1><p class="lead">Check your connection. <button type="button" class="hint" id="retry">Try again</button></p>';
    $("retry").addEventListener("click", function () { location.reload(); });
  });
  addEventListener("hashchange", function () { show((location.hash || "").slice(1)); });
})();
