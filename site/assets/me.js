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
      // Everyone gets the same three tabs. Empty ones invite them in instead of hiding.
      var tabs = [["fan", "Fan"], ["artist", "Artist"], ["crew", "Promoter"]];
      if (!tab) { try { tab = localStorage.getItem("me_tab") || ""; } catch (e) {} }
      if (!/^(fan|artist|crew)$/.test(tab)) tab = d.crews.length || d.staff ? "crew" : d.artist.length || d.profile ? "artist" : "fan";
      $("tabs").hidden = false;
      $("tabs").innerHTML = tabs.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + esc(t[1]) + "</button>"; }).join("");
      draw();
    }).catch(function (err) { if (tok) $("msg").textContent = err.message; });
  }
  $("tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (!b) return; tab = b.getAttribute("data-tab"); hub = ""; try { localStorage.setItem("me_tab", tab); } catch (err) {} load(); });

  var LINKS = [["instagram", "Instagram"], ["soundcloud", "SoundCloud"], ["spotify", "Spotify"], ["tiktok", "TikTok"], ["youtube", "YouTube"], ["website", "Website"]];
  var editing = false;
  function profileForm(p) {
    p = p || { links: {} };
    return '<form class="mcard pform" id="pform" novalidate><h3>' + (me.profile ? "Edit your artist profile" : "Create your artist profile") + '</h3>' +
      '<div class="sub">One profile for every show you play. Promoters who book you get it already filled in.</div>' +
      '<label for="pname">Artist name</label><input id="pname" maxlength="60" value="' + esc(p.name || "") + '">' +
      '<label for="pgenre">Sound</label><input id="pgenre" maxlength="60" placeholder="e.g. riddim, dubstep, wave" value="' + esc(p.genre || "") + '">' +
      '<label for="phome">Hometown</label><input id="phome" maxlength="60" placeholder="e.g. Peoria, IL" value="' + esc(p.hometown || "") + '">' +
      '<label for="pbio">Bio</label><textarea id="pbio" maxlength="400" rows="3">' + esc(p.bio || "") + "</textarea>" +
      LINKS.map(function (l) { return '<label for="pl-' + l[0] + '">' + l[1] + '</label><input id="pl-' + l[0] + '" maxlength="300" value="' + esc((p.links || {})[l[0]] || "") + '">'; }).join("") +
      '<button class="mbtn" type="submit">Save profile</button> ' + (me.profile ? '<button class="mbtn ghost" type="button" data-cancel>Cancel</button>' : "") +
      '<p class="msg" id="pmsg" role="status"></p></form>';
  }
  function draw() {
    var d = me, h = "";
    if (tab === "fan") {
      h += d.tickets.length ? d.tickets.map(function (s) {
        return '<div class="mcard"><h3>' + esc(s.show) + '</h3><div class="sub">' + esc([s.nights.join(" + "), s.city].filter(Boolean).join(" · ")) + "</div>" +
          s.tickets.map(function (t) { return '<div class="mrow"><span>' + esc(t.type) + ' <span class="mono">' + esc(t.code) + '</span></span><a href="' + esc(t.url) + '">Open</a></div>'; }).join("") + "</div>";
      }).join("") : '<div class="mcard"><h3>No tickets yet</h3><div class="sub">Tickets you buy with this email show up here automatically.</div></div>';
      h += '<div class="mcard"><h3>Your music</h3><div class="sub">Every track you\'ve unlocked, to play or download.</div><a class="mbtn" href="' + esc(d.music) + '">Open my collection</a></div>';
    }
    if (tab === "artist") {
      if (editing) h += profileForm(d.profile);
      else if (d.profile) {
        var p = d.profile, ls = LINKS.filter(function (l) { return p.links && p.links[l[0]]; });
        h += '<div class="mcard prof">' + (p.photo ? '<img class="pimg" src="' + esc(p.photo) + '" alt="">' : "") +
          "<div><h3>" + esc(p.name || "") + '</h3><div class="sub">' + esc([p.genre, p.hometown].filter(Boolean).join(" · ")) + "</div>" +
          (p.bio ? '<p class="pbio">' + esc(p.bio) + "</p>" : "") +
          (ls.length ? '<div class="plinks">' + ls.map(function (l) { return '<a href="' + esc(p.links[l[0]]) + '" target="_blank" rel="noopener">' + l[1] + "</a>"; }).join("") + "</div>" : "") +
          (d.artist_preview ? '<button type="button" class="mbtn ghost" data-edit>Edit profile</button>' : "") + "</div></div>";
      }
      if (d.artist.length) {
        h += '<div class="roleh">Your shows</div>' + d.artist.map(function (a) {
          return '<div class="mcard"><h3>' + esc(a.show) + '</h3><div class="sub">As ' + esc(a.name) + " · " + esc(a.nights.join(" + ")) + "</div>" +
            (a.sell_link ? '<div class="mrow"><span><b>' + a.sold + (a.sold === 1 ? " ticket" : " tickets") + ' sold</b><br><span class="mono">' + esc(a.sell_link.replace(/^https?:\/\//, "")) + '</span></span><button type="button" class="mbtn ghost" data-copy="' + esc(a.sell_link) + '">Copy link</button></div>' : "") +
            '<a class="mbtn" href="' + esc(a.url) + '">' + (a.claimed ? "Artist dashboard" : "Get my artist pass") + "</a></div>";
        }).join("");
      }
      if (!d.profile && !d.artist.length && !editing) {
        h += d.artist_preview
          ? '<div class="mcard"><h3>Play shows?</h3><div class="sub">Make one artist profile. Every promoter who books you gets it already filled in, and your shows, passes and sell links all live here.</div><button type="button" class="mbtn" data-edit>Create artist profile</button></div>'
          : '<div class="mcard"><h3>Artist profiles are coming soon</h3><div class="sub">One profile for every show you play, with your passes, guest lists and sell links in one place. Join the list and we\'ll tell you the day it opens.</div><a class="mbtn" href="' + esc(d.waitlist) + '">Join the artist list</a></div>';
      }
    }
    if (tab === "crew") {
      if (hub) { drawHub(); return; }
      if (d.staff) h += '<div class="mcard"><h3>Subduction staff</h3><div class="sub">Every show, every crew.</div><a class="mbtn" href="admin.html">Staff app</a> <a class="mbtn ghost" href="promoter.html">Promoter app</a></div>';
      d.crews.slice().sort(function (a, b) { return (a.kind === "promoter" ? 0 : 1) - (b.kind === "promoter" ? 0 : 1); }).forEach(function (c) {
        h += '<div class="crewh"><div><h3>' + esc(c.name) + '</h3><div class="sub">' + (c.role === "owner" ? "You run this crew" : "You're on this crew") +
          (c.kind === "original" ? " · original ticketing" : c.stripe_ready ? " · sells with your Stripe" : " · connect Stripe to sell") + "</div></div>" +
          (c.kind === "promoter" ? '<a class="mbtn" href="promoter.html#show/new/1">+ Add a show</a>' : "") + "</div>";
        if (c.kind === "promoter" && !c.stripe_ready && c.role === "owner") h += '<div class="mcard warn"><b>Connect Stripe</b> so ticket money goes straight to your bank. <a class="mlink" href="promoter.html">Open promoter app</a></div>';
        h += (c.shows || []).length ? '<div class="tiles">' + c.shows.map(function (sh) {
          return '<button type="button" class="tile" data-hub="' + esc(sh.slug) + '" style="--m:' + esc(sh.colors.main) + ';--a:' + esc(sh.colors.accent) + ';--d:' + esc(sh.colors.deep) + '">' +
            (sh.image ? '<span class="tart" style="background-image:url(\'' + esc(sh.image) + '\')"></span>' : '<span class="tart blank"></span>') +
            '<span class="tbody"><b>' + esc(sh.name) + '</b><span>' + esc(sh.nights.join(" + ")) + '</span><i class="tchip">' + (sh.on_sale ? "On sale" : "Not on sale") + "</i></span></button>";
        }).join("") + "</div>" : '<p class="mempty">No shows yet.' + (c.kind === "promoter" ? " Tap + Add a show." : "") + "</p>";
      });
      if (!d.crews.length && !d.staff) h += '<div class="mcard"><h3>Throw a show?</h3><div class="sub">Sell tickets with your own Stripe, a $1.50 fee your buyers pay, and a custom page for every show. Try it with a test ticket first, it takes a minute.</div><a class="mbtn" href="' + esc(d.demo) + '">Start throwing events</a></div>';
    }
    $("panes").innerHTML = h;
  }

  // Profile: edit, cancel, save. Copy buttons for sell links.
  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    if (e.target.closest("[data-edit]")) { editing = true; draw(); return; }
    if (e.target.closest("[data-cancel]")) { editing = false; draw(); return; }
    var c = e.target.closest("[data-copy]");
    if (c) {
      var t = c.getAttribute("data-copy"), was = c.textContent, done = function () { c.textContent = "Copied"; setTimeout(function () { c.textContent = was; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { window.prompt("Copy this:", t); }); else window.prompt("Copy this:", t);
    }
  });
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "pform") return;
    e.preventDefault();
    var links = {}; LINKS.forEach(function (l) { links[l[0]] = $("pl-" + l[0]).value.trim(); });
    $("pmsg").textContent = "Saving...";
    api("", { a: "profile", name: $("pname").value.trim(), genre: $("pgenre").value.trim(), hometown: $("phome").value.trim(), bio: $("pbio").value.trim(), links: links })
      .then(function () { editing = false; load(); }).catch(function (err) { $("pmsg").textContent = err.message; });
  });

  // ---- the show hub: one show, in its own colors ----
  var hub = "", hubData = null;
  function drawHub() {
    var r = hubData, P = $("panes");
    if (!r) { P.innerHTML = '<p class="mempty">Loading the show...</p>'; return; }
    var max = Math.max.apply(null, r.last7.map(function (x) { return x.tickets; }).concat([1]));
    var qr = FN + "?a=qr&e=" + encodeURIComponent(r.slug);
    P.innerHTML = '<div class="hub" style="--m:' + esc(r.colors.main) + ';--a:' + esc(r.colors.accent) + ';--d:' + esc(r.colors.deep) + '">' +
      '<button type="button" class="hback" data-back>← All shows</button>' +
      '<div class="hhero">' + (r.image ? '<span class="hart" style="background-image:url(\'' + esc(r.image) + '\')"></span>' : "") +
        '<div class="hhead"><h2>' + esc(r.show) + '</h2><div>' + esc([r.nights.join(" + "), r.venue, r.city, r.age].filter(Boolean).join(" · ")) + '</div><i class="tchip">' + (r.on_sale ? "On sale" : "Not on sale") + "</i></div></div>" +
      // Share
      '<section class="hsec"><h4>Share</h4><div class="share"><img src="' + esc(qr) + '" alt="QR code for the show link" width="104" height="104"><div>' +
        '<div class="slink">' + esc(r.link.replace(/^https?:\/\//, "")) + '</div><button type="button" class="mbtn" data-copy="' + esc(r.link) + '">Copy link</button> ' +
        '<a class="mbtn ghost" href="' + esc(r.link) + '" target="_blank" rel="noopener">Open the page</a> <a class="mbtn ghost" href="' + esc(qr) + '" target="_blank" rel="noopener">Save QR</a></div></div></section>' +
      // Numbers
      '<section class="hsec"><h4>Numbers</h4><div class="stats"><div><b>' + r.sold + '</b><span>Sold</span></div><div><b>' + usd(r.money_cents) + '</b><span>Tickets in</span></div><div><b>' + r.comps + "</b><span>Guest list</span></div></div>" +
        r.by_type.filter(function (t) { return t.sold || t.comps; }).map(function (t) { return '<div class="mrow"><span>' + esc(t.name) + "</span><span>" + t.sold + " sold" + (t.comps ? " · " + t.comps + " guest" : "") + "</span></div>"; }).join("") +
        '<div class="sub" style="margin-top:12px">Last 7 days</div><div class="bars">' + r.last7.map(function (x) { return '<i style="height:' + Math.round(100 * x.tickets / max) + '%" title="' + x.tickets + '"></i>'; }).join("") + "</div>" +
        '<div class="barl">' + r.last7.map(function (x) { return "<span>" + x.day.slice(8) + "</span>"; }).join("") + "</div></section>" +
      // Is everything right?
      '<section class="hsec"><h4>Is everything right?</h4>' + r.checks.map(function (c) { return '<div class="chk ' + (c.ok ? "ok" : "no") + '"><i>' + (c.ok ? "✓" : "!") + "</i>" + esc(c.label) + "</div>"; }).join("") +
        (r.prices.length ? '<div class="sub" style="margin-top:12px">On sale now</div>' + r.prices.map(function (p) { return '<div class="mrow"><span>' + esc(p.name) + ' <span class="mono">' + esc(p.tier) + "</span></span><span>" + (p.price_cents != null ? usd(p.price_cents) + " · " + p.left + " left" : "Sold out") + "</span></div>"; }).join("") : "") + "</section>" +
      // Artists
      '<section class="hsec"><h4>Artists</h4>' + (r.artists.length ? r.artists.map(function (a) {
          return '<div class="mrow"><span><b>' + esc(a.name) + '</b><br><span class="mono">' + (a.claimed ? "Pass sent" : "Pass not claimed yet") + " · " + a.tickets + " sold · " + a.taps + " taps</span></span>" +
            (a.link ? '<button type="button" class="mbtn ghost" data-copy="' + esc(a.link) + '">Copy sell link</button>' : "") + "</div>";
        }).join("") : '<p class="mempty">No artists yet.</p>') +
        '<p class="soon">Adding artists, guest passes and set times from here is coming next.</p></section>' +
      // Playlist
      '<section class="hsec"><h4>Playlist</h4><div class="mrow"><span>' + (r.playlist.artist_tracks + r.playlist.tracks) + ' tracks in rotation</span><span class="mono">' + (r.playlist.mode === "subduction" && !r.playlist.tracks ? "plus Subduction picks" : "") + "</span></div></section>" +
      "</div>";
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var b = e.target.closest("[data-hub]");
    if (b) {
      hub = b.getAttribute("data-hub"); hubData = null; drawHub(); window.scrollTo(0, 0);
      api("?a=crew&e=" + encodeURIComponent(hub)).then(function (r) { hubData = r; if (hub && tab === "crew") drawHub(); })
        .catch(function (err) { $("panes").innerHTML = '<p class="mempty">' + esc(err.message) + "</p>"; });
      return;
    }
    if (e.target.closest("[data-back]")) { hub = ""; hubData = null; draw(); }
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
