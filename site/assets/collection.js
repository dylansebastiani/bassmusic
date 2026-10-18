/* The member app: Collection, Coupons, Events, Shop. Signed in by the key this phone already holds. */
(function () {
  var S = window.Stack, C = S.C, $ = function (id) { return document.getElementById(id); }, esc = S.esc;
  var TABS = ["collection", "coupons", "events", "shop"];
  var KINDS = { show: "Show", popup: "Pop-up", drop: "Drop", other: "Event" };
  var t = S.token(), data = null, refresher = null;
  S.pageview("/collection");

  $("signout").addEventListener("click", function () { S.forget(); location.replace("./"); });

  // ---------- tabs ----------
  function show(name) {
    if (TABS.indexOf(name) < 0) name = "collection";
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
    window.Join.mount($("join"), { cta: "Open my collection", onDone: function () { location.reload(); } });
    return;
  }

  // ---------- render ----------
  function trackCard(k, big) {
    return '<article class="card track' + (big ? " big new" : "") + '" data-slug="' + esc(k.slug) + '">' +
      (k.artwork_url ? '<img class="cover" src="' + esc(k.artwork_url) + '" alt="" loading="lazy">' : '<div class="cover blank"></div>') +
      "<div>" + (big ? '<span class="chip">Unlocked</span> ' : "") + "<h3>" + esc(k.title) + "</h3>" +
      (k.artist ? '<div class="by">' + esc(k.artist) + "</div>" : "") + "</div>" +
      (k.audio_url ? '<audio controls controlsList="nodownload noplaybackrate" preload="none" src="' + esc(k.audio_url) + '"></audio>' : "") +
      (k.download_url ? '<a class="btn ghost dl" href="' + esc(k.download_url) + '" rel="noopener">Download WAV</a>' : "") +
      "</article>";
  }
  // The wall, same as the welcome track: first name, phone and ZIP open play and download for every track.
  function wallForm() {
    return '<form id="wall" class="wall" novalidate>' +
      '<p class="gate">Drop your name, number and ZIP to unlock it. Play it here or download the WAV. One time, then every track opens.</p>' +
      '<label for="first_name">First name</label><input type="text" id="first_name" autocomplete="given-name" placeholder="first name" required>' +
      '<div class="row2"><div><label for="phone">Phone</label><input type="tel" id="phone" autocomplete="tel" placeholder="phone" required></div>' +
      '<div><label for="zip">ZIP</label><input type="text" id="zip" inputmode="numeric" autocomplete="postal-code" placeholder="zip" required></div></div>' +
      '<label class="check"><input type="checkbox" id="sms"><span>' + esc(S.fill ? S.fill(C.smsConsentText, { LABEL_NAME: C.labelName }) : String(C.smsConsentText || "").replace("{{LABEL_NAME}}", C.labelName || "")) + "</span></label>" +
      '<label class="check"><input type="checkbox" id="age"><span>' + esc(C.ageText || "I'm 13 or older.") + "</span></label>" +
      '<button type="submit" class="btn" id="wallBtn">Unlock the track</button>' +
      '<div class="msg" id="wallMsg" role="status"></div></form>';
  }
  function paintTracks(d) {
    var el = $("p-collection"), fresh = S.q.get("new");
    var focus = fresh ? d.tracks.filter(function (k) { return k.slug === fresh; })[0] : null;
    var rest = d.tracks.filter(function (k) { return k !== focus; });
    var html = "";
    if (focus) html += trackCard(focus, true) + (d.profile_done ? "" : wallForm());
    else if (!d.profile_done && d.tracks.length) html += wallForm();
    html += '<h2 class="disp">' + (d.first_name ? esc(d.first_name) + "'s " : "My ") + "collection</h2>";
    if (!d.tracks.length) html += '<div class="empty">Nothing here yet. Every track has its own QR code. Scan one at a show or pop-up and it lands here.</div>';
    else if (rest.length) html += '<div class="list">' + rest.map(function (k) { return trackCard(k, false); }).join("") + "</div>";
    el.innerHTML = html;
    $("n-collection").textContent = d.tracks.length ? "(" + d.tracks.length + ")" : "";
    var w = $("wall");
    if (w) w.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("first_name").value.trim(), phone = $("phone").value.trim(), zip = $("zip").value.trim(), m = $("wallMsg");
      if (!name) return say(m, "Add your first name.", $("first_name"));
      if (phone.replace(/\D/g, "").length < 10) return say(m, "Add your phone number.", $("phone"));
      if (!/^\d{5}(-?\d{4})?$/.test(zip)) return say(m, "Add your ZIP.", $("zip"));
      $("wallBtn").disabled = true; m.textContent = "Unlocking...";
      S.api("profile", { t: t, unlock: true, first_name: name, zip: zip, phone: phone, sms_consent: $("sms").checked, age_confirmed: $("age").checked })
        .then(function () { return load(true); })
        .catch(function (err) { $("wallBtn").disabled = false; m.textContent = err.message || "Couldn't save. Try again."; });
    });
  }
  function say(m, text, field) { m.textContent = text; if (field) field.focus(); }
  function paintCoupons(d) {
    var html = '<h2 class="disp">Coupons</h2>';
    if (!d.coupons.length) html += '<div class="empty">No codes right now. Check back after the next show.</div>';
    else html += '<div class="list">' + d.coupons.map(function (c) {
      var link = S.safeUrl(c.url);
      return '<article class="card"><h3>' + esc(c.title) + "</h3>" + (c.description ? '<div class="where">' + esc(c.description) + "</div>" : "") +
        (c.locked ? '<div class="lock">Collect ' + c.need + " more track" + (c.need > 1 ? "s" : "") + " to unlock</div>"
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
        (e.prize ? '<div class="when">Giveaway: ' + esc(e.prize) + "</div>" : "") +
        (link ? '<a class="btn ghost" href="' + esc(link) + '" rel="noopener" target="_blank">Tickets / info</a>' : "") + "</article>";
    }).join("") + "</div>";
    $("p-events").innerHTML = html;
  }
  $("app").addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]"); if (!b) return;
    var code = b.getAttribute("data-copy");
    function done() { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500); }
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, function () {});
    else { var r = document.createRange(); r.selectNodeContents(b.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); done(); }
  });

  $("p-collection").addEventListener("play", function (e) { Array.prototype.forEach.call(document.querySelectorAll("#p-collection audio"), function (a) { if (a !== e.target) a.pause(); }); }, true);

  // ---------- load, and keep the 10-minute links fresh ----------
  function load(first) {
    return S.get("collection", { t: t }).then(function (d) {
      data = d;
      if (first) {
        paintTracks(d); paintCoupons(d); paintEvents(d);
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
