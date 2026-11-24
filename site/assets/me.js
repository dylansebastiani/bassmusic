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
      $("smsg").innerHTML = "If that email has tickets, a show or a crew here, a sign-in button is on its way to <b>" + esc(email) + "</b>. Open it on this phone.";
    }).catch(function (err) { $("smsg").textContent = err.message; }).then(function () { $("sgo").disabled = false; });
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
      if (d.tickets.length || (!d.artist.length && !d.crews.length)) tabs.push(["fan", "Tickets & music"]);
      if (d.artist.length) tabs.push(["artist", "My shows"]);
      if (d.crews.length || d.staff) tabs.push(["crew", "My crews"]);
      if (!tab || !tabs.some(function (t) { return t[0] === tab; })) tab = tabs[0][0];
      $("tabs").hidden = tabs.length < 2;
      $("tabs").innerHTML = tabs.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + esc(t[1]) + "</button>"; }).join("");
      draw();
    }).catch(function (err) { if (tok) $("msg").textContent = err.message; });
  }
  $("tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (!b) return; tab = b.getAttribute("data-tab"); load(); });

  function draw() {
    var d = me, h = "";
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
