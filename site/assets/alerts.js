/* City show alerts on /shows and the city pages. One email box: a fan picks a city (or the page's city)
   and gets one email each time a new show lands there. Also handles the unsubscribe link from those emails
   (/shows?unalert=<token>). The token is the only thing in the link, never an email. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/directory";
  var box = document.getElementById("alerts"); if (!box) return;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var post = function (body) {
    return fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "Couldn't save that. Try again."); return j; }); });
  };

  // ---- unsubscribe from an alert email ----
  var q = new URLSearchParams(location.search), un = (q.get("unalert") || "").trim();
  if (/^[0-9a-f]{64}$/.test(un)) {
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    var note = document.createElement("p"); note.className = "alert-note"; note.setAttribute("role", "status"); note.textContent = "Taking you off the list...";
    var main = document.querySelector("main"); if (main) main.insertBefore(note, main.firstChild);
    post({ a: "unalert", k: un }).then(function (r) { note.textContent = "Done. No more show emails for " + (r.city || "that city") + "."; })
      .catch(function (e) { note.textContent = e.message; });
  }

  // ---- the sign-up box ----
  var path = window.__SHOWS_CITY || "", name = window.__SHOWS_CITY_NAME || "";
  var city = name ? name.split(",")[0] : "";
  box.innerHTML = '<p class="kick">Show alerts</p>' +
    '<h2 class="disp">Never miss a ' + (city ? "<em>" + esc(city) + "</em> show." : "show <em>near you.</em>") + "</h2>" +
    '<p class="alert-lead">One email when a new show lands' + (city ? " in " + esc(city) : " in your city") + ". The flyer and the ticket link. Nothing else.</p>" +
    '<form class="alert-form" id="alertForm" novalidate>' +
    (path ? "" : '<label class="sr" for="alertCity">City</label><select id="alertCity" required><option value="">Pick your city</option></select>') +
    '<div class="unit"><label class="sr" for="alertEmail">Email</label><input id="alertEmail" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@email.com">' +
    '<input type="text" name="website" id="alertHp" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<button class="btn" type="submit" id="alertGo">Tell me</button></div><div id="alertTs"></div>' +
    '<p class="alert-msg" id="alertMsg" role="status"></p></form>';
  var $ = function (id) { return document.getElementById(id); };
  if (!path) {
    fetch("/assets/cities.json").then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      $("alertCity").insertAdjacentHTML("beforeend", list.map(function (c) { return '<option value="' + esc(c[0]) + '">' + esc(c[1]) + "</option>"; }).join(""));
    }).catch(function () {});
  }

  // Bot check, the same invisible one the other email boxes use. It loads when someone starts typing.
  var tsToken = null, tsId = null, tsLoaded = false, waiters = [];
  function loadTs() {
    if (tsLoaded || !C.turnstileSiteKey) return; tsLoaded = true;
    window.__alertTs = function () {
      tsId = turnstile.render("#alertTs", { sitekey: C.turnstileSiteKey, action: "alert", appearance: "interaction-only", "refresh-expired": "auto",
        callback: function (t) { tsToken = t; waiters.splice(0).forEach(function (f) { f(); }); } });
    };
    var s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__alertTs&render=explicit"; s.async = true; document.head.appendChild(s);
  }
  function tsPass(ms) {
    if (!C.turnstileSiteKey || tsToken) return Promise.resolve();
    loadTs(); return new Promise(function (res) { waiters.push(res); setTimeout(res, ms); });
  }
  $("alertEmail").addEventListener("focus", loadTs, { once: true });
  $("alertForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("alertEmail").value.trim(), msg = $("alertMsg");
    var p = path, n = name;
    if (!p) { var sel = $("alertCity"); p = sel.value; n = sel.value ? sel.options[sel.selectedIndex].text : ""; }
    if (!p) { msg.textContent = "Pick your city."; $("alertCity").focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { msg.textContent = "That email doesn't look right."; $("alertEmail").focus(); return; }
    $("alertGo").disabled = true; msg.textContent = "Saving...";
    tsPass(12000).then(function () {
      return post({ a: "alert", email: email, city: p, city_name: n, website: $("alertHp").value, turnstile: tsToken || "" });
    }).then(function (r) {
      box.classList.add("done");
      box.innerHTML = '<p class="kick">Show alerts</p><h2 class="disp">You\'re on the <em>' + esc((r.city || n).split(",")[0]) + "</em> list.</h2>" +
        '<p class="alert-lead">The next show there lands in your inbox. Every email has a one-tap way out.</p>';
    }).catch(function (err) {
      msg.textContent = err.message; $("alertGo").disabled = false;
      tsToken = null; if (tsId !== null && window.turnstile) turnstile.reset(tsId);
    });
  });
})();
