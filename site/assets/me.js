// My account: sign in once, see whatever you are here (fan, artist, promoter). Same saved sign-in as the
// promoter and staff apps ("stack_admin"), so the promoter app opens already signed in.
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/account";
  var KEY = "stack_admin", tok = ""; try { tok = localStorage.getItem(KEY) || ""; } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var usd = function (c) { return "$" + ((c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }); };
  var me = null, tab = "";

  function api(q, body) {
    var o = { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" } };
    if (tok) o.headers["x-admin-token"] = tok;
    if (body) o.body = JSON.stringify(body);
    return fetch(FN + (q || ""), o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { signOut(); throw new Error("Sign in again."); }
        if (!r.ok) throw new Error(j.error || "Something went wrong. Try again.");
        return j;
      });
    });
  }
  function signOut() { tok = ""; try { localStorage.removeItem(KEY); } catch (e) {} show("signin"); }
  function show(which) {
    $("signin").hidden = which !== "signin"; $("home").hidden = which !== "home"; $("signout").hidden = which !== "home";
    if (which === "signin") $("msg").textContent = "";
  }

  // ---- sign in ----
  $("sf").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("semail").value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { $("smsg").textContent = "Check your email address."; return; }
    $("sgo").disabled = true; $("smsg").textContent = "Sending...";
    api("", { a: "signin", email: email }).then(function () {
      $("smsg").innerHTML = "If that email has tickets, a show or a crew here, a sign-in email is on its way to <b>" + esc(email) + "</b>. Tap the button in it, or type its code below.";
      sentTo = email; $("cf").hidden = false; $("ccode").focus();
    }).catch(function (err) { $("smsg").textContent = err.message; }).then(function () { $("sgo").disabled = false; });
  });
  var sentTo = "";
  $("cf").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("ccode").value.replace(/\D/g, "");
    if (code.length !== 6) { $("smsg").textContent = "The code is 6 digits."; return; }
    $("cgo").disabled = true; $("smsg").textContent = "Checking...";
    api("", { a: "code", email: sentTo || $("semail").value.trim(), code: code }).then(function (r) {
      tok = r.token; try { localStorage.setItem(KEY, tok); } catch (err) {} $("cf").hidden = true; $("smsg").textContent = ""; load();
    }).catch(function (err) { $("smsg").textContent = err.message; }).then(function () { $("cgo").disabled = false; });
  });
  $("signout").addEventListener("click", signOut);

  // ---- home ----
  function load() {
    $("msg").textContent = "Loading...";
    api("?a=me").then(function (d) {
      me = d; $("msg").textContent = ""; show("home");
      $("hi").innerHTML = "Hey" + (d.name ? " <em>" + esc(d.name) + "</em>" : "");
      $("who").textContent = d.email;
      var tabs = [];
      var roles = (d.tickets.length ? 1 : 0) + (d.artist.length ? 1 : 0) + (d.crews.length || d.staff ? 1 : 0);
      if (roles > 1) tabs.push(["home", "Home"]);
      if (d.tickets.length || (!d.artist.length && !d.crews.length)) tabs.push(["fan", "Tickets & music"]);
      if (d.artist.length) tabs.push(["artist", "Artist"]);
      if (d.crews.length || d.staff) tabs.push(["crew", "Promoter"]);
      if (!tab || !tabs.some(function (t) { return t[0] === tab; })) tab = tabs[0][0];
      $("tabs").hidden = tabs.length < 2;
      $("tabs").innerHTML = tabs.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + esc(t[1]) + "</button>"; }).join("");
      draw();
    }).catch(function (err) { if (tok) $("msg").textContent = err.message; });
  }
  $("tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (!b) return; tab = b.getAttribute("data-tab"); load(); });
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-go]"); if (!b) return; tab = b.getAttribute("data-go"); load(); });

  function draw() {
    var d = me, h = "";
    // Home: one card per role with its main buttons, so nothing hides behind a tab.
    if (tab === "home") {
      if (d.crews.length || d.staff) {
        h += '<div class="roleh">Promoter</div>';
        if (d.staff) h += '<div class="mcard"><h3>Subduction staff</h3><a class="mbtn" href="admin.html">Staff app</a></div>';
        d.crews.forEach(function (c) {
          h += '<div class="mcard"><h3>' + esc(c.name) + '</h3><div class="sub">' + (c.role === "owner" ? "You run this crew" : "You're on this crew") + "</div>" +
            (c.kind === "promoter" ? '<a class="mbtn" href="promoter.html">Open promoter app</a>' : '<button type="button" class="mbtn" data-go="crew">Show numbers</button>') + "</div>";
        });
      }
      if (d.artist.length) {
        h += '<div class="roleh">Artist</div>';
        d.artist.forEach(function (a) {
          h += '<div class="mcard"><h3>' + esc(a.name) + '</h3><div class="sub">' + esc(a.show) + " · " + esc(a.nights.join(" + ")) + "</div>" +
            '<a class="mbtn" href="' + esc(a.url) + '">' + (a.claimed ? "Artist dashboard" : "Get my artist pass") + '</a><div class="sub" style="margin:8px 0 0">Your pass, guest list, tracks and sell link.</div></div>';
        });
      }
      if (d.tickets.length) {
        var n = d.tickets.reduce(function (a, s) { return a + s.tickets.length; }, 0);
        h += '<div class="roleh">Fan</div><div class="mcard"><h3>' + n + (n === 1 ? " ticket" : " tickets") + '</h3><div class="sub">' + esc(d.tickets.map(function (s) { return s.show; }).join(", ")) + "</div>" +
          '<button type="button" class="mbtn" data-go="fan">My tickets</button> <a class="mbtn ghost" href="' + esc(d.music) + '">My music</a></div>';
      }
    }
    if (tab === "fan") {
      h += d.tickets.length ? d.tickets.map(function (s) {
        return '<div class="mcard"><h3>' + esc(s.show) + '</h3><div class="sub">' + esc([s.nights.join(" + "), s.city].filter(Boolean).join(" · ")) + "</div>" +
          s.tickets.map(function (t) { return '<div class="mrow"><span>' + esc(t.type) + ' <span class="mono">' + esc(t.code) + '</span></span><a href="' + esc(t.url) + '">Open ticket</a></div>'; }).join("") + "</div>";
      }).join("") : '<p class="mempty">No tickets on this email yet.</p>';
      h += '<div class="mcard"><h3>Your music</h3><div class="sub">Every track you\'ve unlocked, to play or download.</div><a class="mbtn" href="' + esc(d.music) + '">Open my collection</a></div>';
    }
    if (tab === "artist") {
      h += d.artist.map(function (a) {
        return '<div class="mcard"><h3>' + esc(a.show) + '</h3><div class="sub">As ' + esc(a.name) + " · " + esc(a.nights.join(" + ")) + "</div>" +
          '<a class="mbtn" href="' + esc(a.url) + '">' + (a.claimed ? "Pass, guest list, tracks + sell link" : "Get my artist pass") + "</a></div>";
      }).join("");
    }
    if (tab === "crew") {
      if (d.staff) h += '<div class="mcard"><h3>Subduction staff</h3><div class="sub">Every show, every crew.</div><a class="mbtn" href="admin.html">Staff app</a> <a class="mbtn ghost" href="promoter.html">Promoter app</a></div>';
      d.crews.forEach(function (c) {
        if (c.kind === "promoter") {
          h += '<div class="mcard"><h3>' + esc(c.name) + '</h3><div class="sub">' + (c.role === "owner" ? "You run this crew" : "You help with this crew") + '</div><a class="mbtn" href="promoter.html">Open promoter app</a></div>';
        } else {
          h += '<div class="mcard"><h3>' + esc(c.name) + "</h3>" + ((c.shows || []).length ? c.shows.map(function (s) {
            return '<div class="mrow"><span>' + esc(s.name) + '<br><span class="mono">' + esc(s.nights.join(" + ")) + '</span></span><button type="button" class="mbtn ghost" data-crew="' + esc(s.slug) + '">Numbers</button></div><div id="cw-' + esc(s.slug) + '"></div>';
          }).join("") : '<p class="mempty">No shows yet.</p>') + "</div>";
        }
      });
    }
    $("panes").innerHTML = h;
  }

  // ---- a show's numbers (crew view, read-only) ----
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-crew]"); if (!b) return;
    var slug = b.getAttribute("data-crew"), box = $("cw-" + slug);
    if (box.innerHTML) { box.innerHTML = ""; return; }
    box.innerHTML = '<p class="mempty">Loading...</p>';
    api("?a=crew&e=" + encodeURIComponent(slug)).then(function (r) {
      var max = Math.max.apply(null, r.last7.map(function (x) { return x.tickets; }).concat([1]));
      box.innerHTML = '<div class="stats"><div><b>' + r.sold + '</b><span>Sold</span></div><div><b>' + usd(r.money_cents) + '</b><span>Tickets in</span></div><div><b>' + r.comps + "</b><span>Guest list</span></div></div>" +
        r.by_type.map(function (t) { return '<div class="mrow"><span>' + esc(t.name) + "</span><span>" + t.sold + " sold" + (t.comps ? " · " + t.comps + " guest" : "") + "</span></div>"; }).join("") +
        '<div class="roleh">Last 7 days</div><div class="bars">' + r.last7.map(function (x) { return '<i style="height:' + Math.round(100 * x.tickets / max) + '%" title="' + x.tickets + '"></i>'; }).join("") + "</div>" +
        '<div class="barl">' + r.last7.map(function (x) { return "<span>" + x.day.slice(8) + "</span>"; }).join("") + "</div>" +
        '<div class="roleh">Artists selling</div>' + (r.artists.length ? r.artists.map(function (a) {
          return '<div class="mrow"><span>' + esc(a.name) + "</span><span>" + a.tickets + " sold · " + a.taps + " taps</span></div>";
        }).join("") : '<p class="mempty">No artists yet.</p>');
    }).catch(function (err) { box.innerHTML = '<p class="mempty">' + esc(err.message) + "</p>"; });
  });

  // ---- arriving from the email button ----
  var invite = (location.hash.match(/^#invite=([0-9a-f-]+\.[0-9a-f]+)$/) || [])[1];
  if (invite) {
    history.replaceState(null, "", location.pathname);
    $("msg").textContent = "Signing you in...";
    api("", { a: "redeem", invite: invite }).then(function (r) { tok = r.token; try { localStorage.setItem(KEY, tok); } catch (e) {} load(); })
      .catch(function (err) { show("signin"); $("smsg").textContent = err.message; });
  } else if (tok) load(); else show("signin");
})();
