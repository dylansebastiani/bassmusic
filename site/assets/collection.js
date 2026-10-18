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
  function paintTracks(d) {
    var el = $("p-collection"), fresh = S.q.get("new");
    var html = '<h2 class="disp">' + (d.first_name ? esc(d.first_name) + "'s " : "My ") + "collection</h2>";
    if (!d.tracks.length) {
      html += '<div class="empty">Nothing here yet. Every track has its own QR code. Scan one at a show or pop-up and it lands here.</div>';
    } else {
      html += '<div class="list">' + d.tracks.map(function (k) {
        var isNew = fresh && k.slug === fresh;
        return '<article class="card track' + (isNew ? " new" : "") + '" data-slug="' + esc(k.slug) + '">' +
          (k.artwork_url ? '<img class="cover" src="' + esc(k.artwork_url) + '" alt="" loading="lazy">' : '<div class="cover blank"></div>') +
          "<div>" + (isNew ? '<span class="chip">Just unlocked</span> ' : "") + "<h3>" + esc(k.title) + "</h3>" +
          (k.artist ? '<div class="by">' + esc(k.artist) + "</div>" : "") + "</div>" +
          (k.audio_url ? '<audio controls controlsList="nodownload noplaybackrate" preload="none" src="' + esc(k.audio_url) + '"></audio>' : "") +
          (k.download_url ? '<div class="dl"><a href="' + esc(k.download_url) + '" rel="noopener">Download WAV</a></div>'
            : k.download_locked ? '<div class="dl">WAV download: <a href="in.html">add your name, phone and ZIP</a> to unlock it.</div>' : "") +
          "</article>";
      }).join("") + "</div>";
    }
    if (d.has_welcome) html += '<p class="fine" style="margin-top:18px"><a class="hint" href="in.html">Your welcome file</a></p>';
    el.innerHTML = html;
    $("n-collection").textContent = d.tracks.length ? "(" + d.tracks.length + ")" : "";
    // One track plays at a time.
    el.addEventListener("play", function (e) { Array.prototype.forEach.call(el.querySelectorAll("audio"), function (a) { if (a !== e.target) a.pause(); }); }, true);
    if (fresh) { $("banner").textContent = "Unlocked. It's in your collection."; $("banner").hidden = false; }
  }
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

  // ---------- load, and keep the 10-minute links fresh ----------
  function load(first) {
    return S.get("collection", { t: t }).then(function (d) {
      data = d;
      if (first) {
        paintTracks(d); paintCoupons(d); paintEvents(d);
        $("app").hidden = false; $("tabs").hidden = false; $("signout").hidden = false;
        show((location.hash || "").slice(1) || "collection");
        refresher = setInterval(function () { load(false).catch(function () {}); }, 8 * 60000);
      } else {
        // Swap the links in place so a playing track never restarts.
        d.tracks.forEach(function (k) {
          var card = document.querySelector('.track[data-slug="' + k.slug.replace(/"/g, "") + '"]'); if (!card) return;
          var a = card.querySelector("audio"); if (a && k.audio_url && a.paused && !a.currentTime) a.src = k.audio_url;
          var dl = card.querySelector(".dl a[download], .dl a[rel]"); if (dl && k.download_url) dl.href = k.download_url;
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
