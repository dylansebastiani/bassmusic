/* Public directory at /shows. Filters run in the browser on the list the directory function returns. */
(function () {
  // Calendar file for one public card. Only public fields go in: name, dates, city, state, ticket link,
  // and the venue name or the words "Secret location". Never a street address.
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
    var where = [s.secret ? "Secret location" : (s.venue || ""), s.city, s.state].filter(Boolean).join(", ");
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
  // All-in buyer fee, from the shared fee code (assets/fees.js), shown on a $25 ticket: "$2.61 in fees on a $25 ticket".
  function feeNote() {
    var F = window.SubductionFees;
    if (!F) return "";
    return "$" + (F.feeCents(2500) / 100).toFixed(2) + " in fees on a $25 ticket";
  }
  function card(s, i) {
    var own = s.source === "subduction";
    var ext = /^https:\/\//i.test(s.url || "");
    var img = s.flyer ? '<img class="art" src="' + esc(s.flyer) + '" alt="">' : "";
    var label = own && s.slug !== "underground" ? 'Tickets here<small>' + feeNote() + "</small>" : "Tickets";
    var tag = '<span class="tickets">' + label + "</span>";
    var frame = img ? '<span class="frame">' + img + tag + "</span>" : '<span class="frame blank">' + tag + "</span>";
    var venue = s.secret ? "Secret location" : (s.venue || "");
    var city = [s.city, s.state].filter(Boolean).join(", ");
    var names = (s.lineup || []).length ? '<span class="lineup">' + esc(s.lineup.join(", ")) + "</span>" : "";
    var free = own && s.slug && s.slug !== "underground" ? '<span class="free" data-free="' + esc(s.slug) + '" hidden>Free tracks with a ticket</span>' : "";
    var tools = (own && s.slug && s.slug !== "underground" ? '<button type="button" class="tool" data-listen="' + esc(s.slug) + '" hidden>Listen</button>' : "") +
      '<button type="button" class="tool" data-cal="' + i + '">Add to calendar</button>';
    return '<article class="cell"><a class="poster' + (img ? "" : " noart") + '" href="' + esc(s.url) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" +
      frame + '<span class="meta"><span class="when">' + esc(s.when || "") + (s.fresh ? ' <span class="new">Just added</span>' : "") + "</span><h3>" + esc(s.name) + "</h3>" +
      (venue ? '<span class="venue">' + esc(venue) + "</span>" : "") +
      '<span class="city">' + esc(city) + "</span>" + names + free + '</span></a><div class="tools">' + tools + "</div></article>";
  }
  var shown = [];
  var lists = {};
  var audio = null, playing = null;
  function playlistFor(slug) {
    if (!lists[slug]) {
      lists[slug] = fetch((C.supabaseUrl || "") + "/functions/v1/playlist?show=" + encodeURIComponent(slug))
        .then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
        .then(function (j) { return (j.tracks || []).filter(function (t) { return t.audio_url && /^https:\/\//.test(t.audio_url); }); });
    }
    return lists[slug];
  }
  function reveal() {
    var seen = {};
    $("list").querySelectorAll("[data-listen]").forEach(function (b) {
      var slug = b.getAttribute("data-listen");
      if (seen[slug]) return;
      seen[slug] = true;
      playlistFor(slug).then(function (tracks) {
        if (!tracks.length) return;
        $("list").querySelectorAll('[data-listen="' + slug + '"]').forEach(function (x) { x.hidden = false; });
        if (tracks.some(function (t) { return t.downloadable; })) {
          $("list").querySelectorAll('[data-free="' + slug + '"]').forEach(function (x) { x.hidden = false; });
        }
      });
    });
  }
  function stop() {
    if (audio) { audio.pause(); audio = null; }
    document.querySelectorAll("[data-listen]").forEach(function (b) { b.textContent = "Listen"; b.classList.remove("on"); });
    playing = null;
  }
  function listen(btn) {
    var slug = btn.getAttribute("data-listen");
    if (playing === slug) { stop(); return; }
    stop();
    playlistFor(slug).then(function (tracks) {
      if (!tracks.length) return;
      document.querySelectorAll("audio").forEach(function (a) { try { a.pause(); } catch (e) {} });
      var n = Math.floor(Math.random() * tracks.length);
      var a = new Audio();
      audio = a; playing = slug;
      function go() {
        var t = tracks[n % tracks.length];
        a.src = t.audio_url; a.play().catch(function () { stop(); });
        document.querySelectorAll('[data-listen="' + slug + '"]').forEach(function (b) { b.textContent = "Stop: " + (t.title || "track"); b.classList.add("on"); });
      }
      a.addEventListener("ended", function () { n++; go(); });
      go();
    });
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
  function quiet(title, line) {
    return '<div class="quiet"><span class="laser" aria-hidden="true"></span><p class="disp">' + title + "</p><p>" + line + "</p></div>";
  }
  function paint(list) {
    if (!list.length) { $("list").innerHTML = quiet("Nothing <em>up.</em>", "No shows match this search."); return; }
    shown = list;
    $("list").innerHTML = list.map(card).join("");
    reveal();
  }
  function chosen() {
    return { q: $("q").value.trim().toLowerCase(), state: $("state").value, city: $("city").value, date: $("on").value };
  }
  function apply() {
    var f = chosen();
    paint(all.filter(function (s) {
      if (f.state && s.state !== f.state) return false;
      if (f.city && s.path !== f.city) return false;
      if (f.date && (s.dates || []).indexOf(f.date) === -1) return false;
      if (f.q && (s.name + " " + s.venue + " " + s.city + " " + s.state).toLowerCase().indexOf(f.q) === -1) return false;
      return true;
    }));
  }
  function cityOptions(state) {
    var seen = {};
    var html = '<option value="">All cities</option>';
    all.forEach(function (s) {
      if (!s.path || seen[s.path]) return;
      if (state && s.state !== state) return;
      seen[s.path] = true;
      html += '<option value="' + esc(s.path) + '">' + esc([s.city, s.state].filter(Boolean).join(", ")) + "</option>";
    });
    var keep = $("city").value || locked;
    $("city").innerHTML = html;
    if (keep && $("city").querySelector('option[value="' + keep.replace(/"/g, "") + '"]')) $("city").value = keep;
  }
  function fillFilters() {
    var seen = {};
    var html = '<option value="">All states</option>';
    all.forEach(function (s) {
      if (!s.state || seen[s.state]) return;
      seen[s.state] = true;
      html += '<option value="' + esc(s.state) + '">' + esc(STATES[s.state] || s.state) + "</option>";
    });
    $("state").innerHTML = html;
    if (locked) {
      all.forEach(function (s) { if (s.path === locked) $("state").value = s.state; });
    }
    cityOptions($("state").value);
    if (locked) $("city").value = locked;
    var hit = null;
    all.forEach(function (s) { if (s.path === locked) hit = s; });
    if (hit && $("title")) {
      $("kick").textContent = [hit.city, STATES[hit.state] || hit.state].filter(Boolean).join(", ");
      $("title").innerHTML = esc(hit.city) + " <em>shows.</em>";
    }
  }

  $("list").addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t) return;
    if (t.hasAttribute("data-cal")) download(Number(t.getAttribute("data-cal")));
    else if (t.hasAttribute("data-listen")) listen(t);
  });
  $("filters").addEventListener("submit", function (e) { e.preventDefault(); });
  ["q", "state", "city", "on"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      if (id === "state") cityOptions($("state").value);
      apply();
    });
    $(id).addEventListener("change", function () {
      if (id === "state") cityOptions($("state").value);
      apply();
    });
  });
  $("clear").addEventListener("click", function () { $("on").value = ""; apply(); });
  $("flyer").addEventListener("change", function () {
    var file = $("flyer").files && $("flyer").files[0];
    var img = $("preview");
    if (!file || !img) return;
    var reader = new FileReader();
    reader.onload = function () { img.src = reader.result; img.hidden = false; $("dropcopy").hidden = true; };
    reader.readAsDataURL(file);
  });

  function say(t) { $("msg").textContent = t; }
  function showDone() { $("form").hidden = true; $("done").hidden = false; }
  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    var trap = $("hp_field");
    if (trap && trap.value) { showDone(); return; }
    var name = $("name").value.trim(), when = $("date").value, venue = $("venue").value.trim();
    var city = $("cityf").value.trim(), state = $("statef").value, link = $("tickets").value.trim(), email = $("email").value.trim();
    var file = $("flyer").files && $("flyer").files[0];
    var today = todayChicago();
    if (!name) { say("Add the show name."); $("name").focus(); return; }
    if (!when || (today && when < today)) { say("Add a date that is today or later."); $("date").focus(); return; }
    if (!venue) { say("Add the venue."); $("venue").focus(); return; }
    if (!city) { say("Add the city."); $("cityf").focus(); return; }
    if (!state) { say("Pick a state."); $("statef").focus(); return; }
    if (!/^https:\/\//i.test(link)) { say("Add a ticket link that starts with https."); $("tickets").focus(); return; }
    if (!file) { say("Add a flyer. JPEG, PNG or WebP, under 1.5 MB."); $("flyer").focus(); return; }
    if (file.size > 1572864) { say("That flyer is too big. Keep it under 1.5 MB."); $("flyer").focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { say("That email doesn't look right."); $("email").focus(); return; }
    var fd = new FormData();
    fd.set("a", "submit");
    fd.set("name", name); fd.set("date", when); fd.set("venue", venue); fd.set("city", city); fd.set("state", state);
    fd.set("ticket_url", link); fd.set("email", email); fd.set("hp_field", trap ? trap.value : "");
    fd.set("flyer", file);
    fd.set("venue_secret", $("secretv").checked ? "1" : "");
    $("go").disabled = true; say("Sending.");
    fetch(FN, { method: "POST", body: fd }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Couldn't send that. Try again."); return j; });
    }).then(function () { say(""); showDone(); }).catch(function (err) {
      say(err.message || "Couldn't send that. Try again.");
      $("go").disabled = false;
    });
  });

  if (window.Stack) Stack.pageview(location.pathname || "/shows");
  locked = pathCity();
  fetch(FN).then(function (r) { return r.json(); }).then(function (j) {
    all = (j && j.shows) || [];
    fillFilters();
    apply();
  }).catch(function () {
    if (!$("list").querySelector(".poster")) $("list").innerHTML = quiet("Hold <em>on.</em>", "The list isn't loading. Try again in a minute.");
  });
})();
