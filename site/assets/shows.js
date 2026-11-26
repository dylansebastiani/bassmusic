/* Public directory at /shows. Filters run in the browser on the list the directory function returns. */
(function () {
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
  function place(s) {
    var where = s.secret ? "Secret location" : s.venue;
    return [where, s.city, s.state].filter(Boolean).join(", ");
  }
  function card(s) {
    var ext = /^https:\/\//i.test(s.url || "");
    var img = s.flyer ? '<img class="art" src="' + esc(s.flyer) + '" alt="">' : "";
    return '<a class="card' + (img ? "" : " noart") + '" href="' + esc(s.url) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" +
      img + "<div><h3>" + esc(s.name) + '</h3><p class="where">' + esc(place(s)) + '</p><span class="go">Tickets</span></div></a>';
  }
  function paint(list) {
    if (!list.length) { $("list").innerHTML = '<p class="empty">No shows on that search yet.</p>'; return; }
    var days = {};
    list.forEach(function (s) {
      var d = (s.dates && s.dates[0]) || "";
      var label = s.when || d;
      if (!days[d]) days[d] = { label: label, shows: [] };
      days[d].shows.push(s);
    });
    $("list").innerHTML = Object.keys(days).sort().map(function (d) {
      var day = days[d];
      return '<section class="day"><h2>' + esc(day.label) + "</h2>" + day.shows.map(card).join("") + "</section>";
    }).join("");
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
  }

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
    if (!$("list").querySelector(".card")) $("list").innerHTML = '<p class="empty">The list isn\'t loading. Try again in a minute.</p>';
  });
})();
