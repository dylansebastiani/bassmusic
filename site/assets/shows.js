/* Public directory at /shows. Filters run in the browser on the list the directory function returns. */
(function () {
  // Calendar file for one public card. Only public fields go in: name, dates, city, state, ticket link,
  // and the words "Secret location" when the venue is secret. Never a venue name or address.
  function icsEsc(t) { return String(t == null ? "" : t).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,"); }
  function icsFold(line) {
    var out = [], rest = line;
    while (rest.length > 73) { out.push(rest.slice(0, 73)); rest = " " + rest.slice(73); }
    out.push(rest);
    return out.join("\r\n");
  }
  function nextDay(ymd) {
    var p = ymd.split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  }
  function buildIcs(s, origin) {
    var url = /^https:\/\//i.test(s.url || "") ? s.url : String(origin || "https://subduction.art").replace(/\/$/, "") + (s.url || "/shows");
    var where = [s.secret ? "Secret location" : "", s.city, s.state].filter(Boolean).join(", ");
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Subduction//Shows//EN", "CALSCALE:GREGORIAN"];
    (s.dates || []).forEach(function (ymd, i) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
      var uid = (String(s.name || "show").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + ymd + "-" + i);
      lines.push("BEGIN:VEVENT", "UID:" + uid + "@subduction.art", "DTSTAMP:" + stamp,
        "DTSTART;VALUE=DATE:" + ymd.replace(/-/g, ""), "DTEND;VALUE=DATE:" + nextDay(ymd),
        "SUMMARY:" + icsEsc(s.name), "LOCATION:" + icsEsc(where), "URL:" + url,
        "DESCRIPTION:" + icsEsc("Tickets: " + url), "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.map(icsFold).join("\r\n") + "\r\n";
  }
  if (typeof window === "undefined") { if (typeof module !== "undefined") module.exports = { buildIcs: buildIcs }; return; }
  var C = window.STACK || {};
  var FN = (C.supabaseUrl || "") + "/functions/v1/directory";
  var $ = function (id) { return document.getElementById(id); };
  var STATES = { IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", MI: "Michigan", MN: "Minnesota", MO: "Missouri", NE: "Nebraska", ND: "North Dakota", OH: "Ohio", SD: "South Dakota", WI: "Wisconsin" };
  var all = [];
  var locked = "";
  var shown = [];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pathCity() {
    if (window.__SHOWS_CITY) return String(window.__SHOWS_CITY);
    var m = location.pathname.match(/^\/shows\/([a-z0-9-]{1,48})\/?$/);
    return m && m[1] !== "review" ? m[1] : "";
  }
  function todayChicago() {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
    catch (e) { return ""; }
  }
  function addDays(ymd, n) {
    var p = ymd.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  // Inclusive [from, to] for the date filter, or null for "All upcoming".
  function range(kind, today, picked) {
    if (kind === "pick") return picked ? [picked, picked] : null;
    if (!today) return null;
    if (kind === "month") return [today, today.slice(0, 7) + "-31"];
    if (kind === "weekend") {
      var p = today.split("-").map(Number);
      var dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); // 0 Sun .. 6 Sat
      if (dow === 0) return [addDays(today, -2), today];
      if (dow === 6) return [addDays(today, -1), addDays(today, 1)];
      var fri = addDays(today, 5 - dow);
      return [dow === 5 ? today : fri, addDays(fri, 2)];
    }
    return null;
  }
  // All-in buyer fee, from the shared fee code (assets/fees.js), shown on a $25 ticket: "$2.61 in fees on a $25 ticket".
  function feeNote() {
    var F = window.SubductionFees;
    if (!F) return "";
    return "$" + (F.feeCents(2500) / 100).toFixed(2) + " in fees on a $25 ticket";
  }
  function isToftu(s) { return s.slug === "underground"; }
  // Tags come from real fields only: fresh, source, secret. T.O.F.T.U. shows only the secret tag.
  function tags(s) {
    var t = [];
    if (s.fresh && !isToftu(s)) t.push("Just added");
    if (s.source === "subduction" && !isToftu(s)) t.push("Tickets on Subduction");
    if (s.secret) t.push("Secret location");
    return t.map(function (x) { return '<li class="tag' + (x === "Just added" ? " new" : "") + '">' + x + "</li>"; }).join("");
  }
  function place(s) { return [s.city, s.state].filter(Boolean).join(", "); }
  function link(s) {
    var ext = /^https:\/\//i.test(s.url || "");
    return 'href="' + esc(s.url) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : "");
  }
  function flyer(s, eager) {
    var wide = isToftu(s);
    var img = s.flyer ? '<img class="art" src="' + esc(s.flyer) + '" alt="Flyer for ' + esc(s.name) + '" width="' + (wide ? 1200 : 800) + '" height="' + (wide ? 630 : 1000) + '"' + (eager ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"') + ">" : "";
    return '<a class="flyer' + (wide ? " wide" : "") + (img ? "" : " blank") + '" ' + link(s) + ' tabindex="-1" aria-hidden="true">' + img + "</a>";
  }
  function fee(s) { return s.source === "subduction" && !isToftu(s) && feeNote() ? '<small class="fee">' + feeNote() + "</small>" : ""; }
  // Only outside listings get the pitch. Subduction checkout shows and T.O.F.T.U. never do.
  function sell(s) { return s.source === "listing" && !isToftu(s) ? '<p class="soft sell">Selling tickets for this? <a href="/promoter.html">Run it on Subduction</a></p>' : ""; }
  function card(s, i) {
    var tools = isToftu(s) ? "" :
      '<div class="tools"><button type="button" class="tool" data-cal="' + i + '">Add to calendar</button>' +
      '<button type="button" class="tool" data-share="' + i + '">Share</button></div>';
    return '<article class="cell">' + flyer(s, false) + '<div class="meta"><p class="when">' + esc(s.when || "") + "</p>" +
      "<h3>" + esc(s.name) + '</h3><p class="city">' + esc(place(s)) + "</p>" +
      '<ul class="tags">' + tags(s) + "</ul>" +
      '<a class="tix" ' + link(s) + ">Tickets</a>" + fee(s) + sell(s) + "</div>" + tools + "</article>";
  }
  function featuredCard(s) {
    return '<section class="feat" aria-label="Featured show">' + flyer(s, true) + '<div class="meta"><p class="kick">Up next on Subduction</p>' +
      '<h2 class="disp">' + esc(s.name) + '</h2><p class="when">' + esc(s.when || "") + '</p><p class="city">' + esc(place(s)) + "</p>" +
      '<ul class="tags">' + (s.secret ? '<li class="tag">Secret location</li>' : "") + "</ul>" +
      '<a class="btn" ' + link(s) + ">Get tickets</a>" + fee(s) + "</div></section>";
  }
  function download(i) {
    var s = shown[i];
    if (!s) return;
    var blob = new Blob([buildIcs(s, location.origin)], { type: "text/calendar;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "show") + ".ics";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function share(i, btn) {
    var s = shown[i];
    if (!s) return;
    var url = /^https:\/\//i.test(s.url || "") ? s.url : location.origin + s.url;
    var done = function (t) { var old = btn.textContent; btn.textContent = t; setTimeout(function () { btn.textContent = old; }, 1800); };
    if (navigator.share) { navigator.share({ title: s.name, url: url }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { done("Link copied"); }, function () { done("Copy failed"); });
    else done("Copy failed");
  }

  function cityList() {
    var by = {}, order = [];
    all.forEach(function (s) {
      if (!s.path) return;
      if (!by[s.path]) { by[s.path] = { path: s.path, name: place(s), n: 0 }; order.push(s.path); }
      by[s.path].n++;
    });
    return order.map(function (k) { return by[k]; }).sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  }
  function paintCities() {
    var list = cityList();
    var html = '<a class="chip' + (locked ? "" : " on") + '" href="/shows"' + (locked ? "" : ' aria-current="page"') + ">All cities <b>" + all.length + "</b></a>";
    var seen = false;
    list.forEach(function (c) {
      var on = c.path === locked; if (on) seen = true;
      html += '<a class="chip' + (on ? " on" : "") + '" href="/shows/' + esc(c.path) + '"' + (on ? ' aria-current="page"' : "") + ">" + esc(c.name) + " <b>" + c.n + "</b></a>";
    });
    if (locked && !seen) {
      var label = window.__SHOWS_CITY_NAME || locked;
      html += '<a class="chip on" href="/shows/' + esc(locked) + '" aria-current="page">' + esc(label) + " <b>0</b></a>";
    }
    $("cities").innerHTML = html;
  }

  function quiet(title, line, extra) {
    return '<div class="quiet"><img class="art" src="/assets/art/fans-burst.webp" width="960" height="400" alt="" loading="lazy" decoding="async"><span class="laser" aria-hidden="true"></span><p class="disp">' + title + "</p><p>" + line + "</p>" + (extra || "") + "</div>";
  }
  function empty() {
    var others = cityList().filter(function (c) { return c.path !== locked; });
    var links = others.length ? '<p class="fine">Cities with shows</p><nav class="chips" aria-label="Cities with shows">' + others.map(function (c) {
      return '<a class="chip" href="/shows/' + esc(c.path) + '">' + esc(c.name) + " <b>" + c.n + "</b></a>";
    }).join("") + "</nav>" : "";
    return quiet("Nothing <em>up yet.</em>", "No shows listed here right now.",
      '<div class="actions"><a class="btn" href="/shows-send">Send in a show</a><a class="btn ghost" href="/promoter">Sell tickets on Subduction</a></div>' + links);
  }
  function chosen() {
    return { q: $("q").value.trim().toLowerCase(), when: $("when").value, on: $("on").value };
  }
  function apply() {
    var f = chosen();
    var today = todayChicago();
    var r = range(f.when, today, f.on);
    var scope = all.filter(function (s) { return !locked || s.path === locked; });
    var plain = !f.q && !r;
    var feat = null;
    scope.forEach(function (s) { if (!feat && s.source === "subduction") feat = s; });
    $("featured").innerHTML = feat && plain ? featuredCard(feat) : "";
    var list = scope.filter(function (s) {
      if (plain && s === feat) return false;
      if (r && !(s.dates || []).some(function (d) { return d >= r[0] && d <= r[1]; })) return false;
      if (f.q && (s.name + " " + s.city + " " + s.state).toLowerCase().indexOf(f.q) === -1) return false;
      return true;
    });
    shown = list;
    if (!scope.length) $("list").innerHTML = empty();
    else if (!list.length && !(plain && feat)) $("list").innerHTML = quiet("Nothing <em>matches.</em>", "Try another date or search.");
    else $("list").innerHTML = list.map(card).join("");
  }

  $("list").addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("button, a[data-send]") : null;
    if (!t) return;
    if (t.hasAttribute("data-cal")) download(Number(t.getAttribute("data-cal")));
    else if (t.hasAttribute("data-share")) share(Number(t.getAttribute("data-share")), t);
  });
  $("filters").addEventListener("submit", function (e) { e.preventDefault(); });
  ["q", "when", "on"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      if (id === "when") { $("onbox").hidden = $("when").value !== "pick"; if ($("when").value === "pick") $("on").focus(); }
      apply();
    });
  });

  if (window.Stack) Stack.pageview(location.pathname || "/shows");
  locked = pathCity();
  // Paint from the list the build wrote into the page, then check the live list in the background.
  var seed = window.__SHOWS_DATA;
  var seeded = Array.isArray(seed);
  if (seeded) { all = seed; paintCities(); apply(); }
  var STALE_MS = 12 * 3600 * 1000;
  fetch(FN).then(function (r) {
    if (!r.ok) throw new Error("bad status");
    return r.json();
  }).then(function (j) {
    // A bad body keeps the seed on screen.
    if (!Array.isArray(j && j.shows)) throw new Error("bad body");
    var live = j.shows;
    if (seeded && JSON.stringify(live) === JSON.stringify(all)) return;
    all = live;
    paintCities();
    apply();
  }).catch(function () {
    // Live fetch failed: an old build may still show a pulled listing, so drop listings, keep Subduction events.
    var built = Number(window.__SHOWS_BUILT);
    if (seeded && built && Date.now() - built > STALE_MS) {
      all = all.filter(function (s) { return s.source !== "listing"; });
      paintCities();
      apply();
    }
    if (!seeded && !$("list").querySelector(".cell") && !$("list").querySelector(".quiet")) $("list").innerHTML = quiet("Hold <em>on.</em>", "The list isn't loading. Try again in a minute.");
  });
})();
