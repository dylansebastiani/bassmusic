// My account: sign in once, see whatever you are here (fan, artist, promoter). Same saved sign-in as the
// promoter and staff apps ("stack_admin"), so the promoter app opens already signed in.
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/account";
  if (window.Stack) Stack.pageview("/me");
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
          : '<div class="mcard"><h3>Your artist page</h3><div class="sub">One page for the shows you play, with your passes, guest lists and sell links. Join with your email.</div><a class="mbtn" href="' + esc(d.waitlist) + '">Join the artist list</a></div>';
      }
    }
    if (tab === "crew") {
      if (hub) { drawHub(); return; }
      if (d.staff) h += '<div class="mcard"><h3>Subduction staff</h3><div class="sub">Every show, every crew.</div><a class="mbtn" href="admin.html">Staff app</a> <a class="mbtn ghost" href="promoter.html">Promoter app</a></div>';
      // One card per crew name: a crew on the new system and its shows on the original ticketing show together.
      var groups = [], byName = {};
      d.crews.forEach(function (c) {
        var k = String(c.name || "").toLowerCase();
        if (!byName[k]) { byName[k] = { name: c.name, owner: false, promo: null, shows: [] }; groups.push(byName[k]); }
        var g = byName[k]; if (c.role === "owner") g.owner = true;
        if (c.kind === "promoter") g.promo = c;
        g.shows = g.shows.concat(c.shows || []);
      });
      groups.forEach(function (g) {
        var p = g.promo;
        h += '<div class="crewh"><div><h3>' + esc(g.name) + '</h3><div class="sub">' + (g.owner ? "You run this crew" : "You're on this crew") +
          (p ? (p.stripe_ready ? ", selling with your Stripe" : "") : "") + "</div></div>" +
          (p ? '<a class="addshow" href="promoter.html#show/new/1">Add a show</a>' : "") + "</div>";
        if (p && !p.stripe_ready && p.role === "owner") h += '<div class="mcard warn"><b>Connect Stripe</b> before your next show goes on sale, so ticket money goes straight to your bank. <a class="mlink" href="promoter.html">Connect it</a></div>';
        h += g.shows.length ? '<div class="posters">' + g.shows.map(function (sh) {
          return '<button type="button" class="poster" data-hub="' + esc(sh.slug) + '" style="--m:' + esc(sh.colors.main) + ';--a:' + esc(sh.colors.accent) + ';--d:' + esc(sh.colors.deep) + '">' +
            '<span class="poart"' + (sh.image ? ' style="background-image:url(\'' + esc(sh.image) + '\')"' : "") + "></span>" +
            '<span class="pcap"><span class="pname">' + esc(sh.name) + '</span><span class="pwhen">' + esc(sh.nights.join(" + ")) + "</span>" +
            '<span class="state' + (sh.on_sale ? " live" : "") + '">' + (sh.on_sale ? "On sale" : "Not on sale yet") + "</span>" +
            (sh.on_sale || sh.sold ? '<span class="psold"><b>' + (sh.sold || 0) + "</b> sold" + (sh.cap ? ", " + sh.cap + " spots a night" : "") + "</span>" : "") + "</span></button>";
        }).join("") + "</div>" : '<p class="mempty">No shows yet.' + (p ? " Tap Add a show to start one." : "") + "</p>";
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
  document.addEventListener("input", function (e) {
    if (!e.target.hasAttribute || !e.target.hasAttribute("data-findbox")) return;
    var q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".prow").forEach(function (row) { row.hidden = !!q && row.getAttribute("data-find").indexOf(q) < 0; });
    if (q) document.querySelectorAll("details.buyers").forEach(function (d) { d.open = true; });
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
  function initials(n) { return String(n || "?").replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase() || "?"; }
  function phoneFmt(v) { var m = String(v || "").match(/^\+1(\d{3})(\d{3})(\d{4})$/); return m ? "(" + m[1] + ") " + m[2] + "-" + m[3] : v; }
  function personRow(p, tag) {
    return '<div class="prow" data-find="' + esc(((p.stage || "") + " " + p.name + " " + p.email + " " + p.phone + " " + (p.list || "")).toLowerCase()) + '">' +
      '<span class="pin' + (p.checked_in ? " in" : "") + '" title="' + (p.checked_in ? "Checked in" : "Not checked in") + '"></span>' +
      '<span class="pinfo"><b>' + esc(p.stage || p.name || "No name") + "</b>" + (p.stage && p.name && p.stage !== p.name ? '<span class="preal">' + esc(p.name) + (p.checked_in ? ", checked in" : "") + "</span>" : "") +
      (tag && p.list ? '<i class="ptag">' + esc(/^Guest of /.test(p.list) ? p.list : p.list + "'s list") + "</i>" : "") +
      (p.stage ? "" : "<span>" + esc(p.what) + (p.checked_in ? ", checked in" : "") + "</span>") +
      '<span class="pcontact">' + [p.phone ? '<a href="tel:' + esc(p.phone) + '">' + esc(phoneFmt(p.phone)) + "</a>" : "", p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + "</a>" : ""].filter(Boolean).join(" ") + "</span></span>" +
      (p.order_id && hubData && hubData.can_add_guests ? '<button type="button" class="prm" data-rm="' + esc(p.order_id) + '" data-rmname="' + esc(p.name) + '">Remove</button>' : "") + "</div>";
  }
  // ---- lineup + set times (draft only; staff publish it) ----
  var lu = null, luDirty = false;
  function luState() { if (!lu && hubData && hubData.lineup) lu = JSON.parse(JSON.stringify(hubData.lineup)); return lu || []; }
  function lineupHtml() {
    var L = luState(), live = L.some(function (n) { return n.public; });
    return '<h3>Lineup and set times</h3><p class="lnote">' + (live
        ? "The lineup is public. Changes you save here are a draft: they go live when Dylan publishes again."
        : "Private draft. Nobody sees this until Dylan publishes the lineup.") + "</p>" +
      L.map(function (n, ni) {
        return '<div class="lnight"><h4 class="gh">' + esc(n.label) + "</h4>" +
          (n.acts.length ? "" : '<p class="mempty">No sets yet.</p>') +
          n.acts.map(function (a, ai) {
            return '<div class="lrow"><input class="ltime" data-ln="' + ni + '" data-la="' + ai + '" data-lf="note" value="' + esc(a.note || "") + '" maxlength="40" placeholder="11–12" aria-label="Set time">' +
              '<input class="lname" data-ln="' + ni + '" data-la="' + ai + '" data-lf="name" value="' + esc(a.name) + '" maxlength="80" placeholder="Artist" aria-label="Artist">' +
              '<span class="lbtns"><button type="button" data-lmv="-1" data-ln="' + ni + '" data-la="' + ai + '" aria-label="Move up"' + (ai ? "" : " disabled") + ">↑</button>" +
              '<button type="button" data-lmv="1" data-ln="' + ni + '" data-la="' + ai + '" aria-label="Move down"' + (ai < n.acts.length - 1 ? "" : " disabled") + ">↓</button>" +
              '<button type="button" data-ldel data-ln="' + ni + '" data-la="' + ai + '" aria-label="Remove this set">✕</button></span></div>';
          }).join("") +
          '<button type="button" class="ladd" data-ladd="' + ni + '">Add a set</button></div>';
      }).join("") +
      '<button type="button" class="mbtn lsave" data-lsave' + (luDirty ? "" : " disabled") + ">Save draft</button>" +
      '<p class="msg" id="lmsg" role="status">' + (luDirty ? "Unsaved changes." : "") + "</p>";
  }
  function luRedraw(focusSel) {
    var sec = $("lsec"); if (!sec) return;
    sec.innerHTML = lineupHtml();
    if (focusSel) { var f = sec.querySelector(focusSel); if (f) f.focus(); }
  }
  document.addEventListener("input", function (e) {
    var el = e.target; if (!el.hasAttribute || !el.hasAttribute("data-lf")) return;
    luState()[+el.getAttribute("data-ln")].acts[+el.getAttribute("data-la")][el.getAttribute("data-lf")] = el.value;
    if (!luDirty) { luDirty = true; var b = document.querySelector("[data-lsave]"); if (b) b.disabled = false; $("lmsg").textContent = "Unsaved changes."; }
  });
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-lmv],[data-ldel],[data-ladd],[data-lsave]"); if (!t) return;
    var L = luState();
    if (t.hasAttribute("data-ladd")) {
      var ni = +t.getAttribute("data-ladd"); L[ni].acts.push({ name: "", note: "" }); luDirty = true;
      return luRedraw('[data-ln="' + ni + '"][data-la="' + (L[ni].acts.length - 1) + '"][data-lf="note"]');
    }
    if (t.hasAttribute("data-lsave")) {
      t.disabled = true; $("lmsg").textContent = "Saving...";
      var body = { a: "lineup", e: hub, nights: L.map(function (n) { return { id: n.id, acts: n.acts.filter(function (x) { return (x.name || "").trim(); }) }; }) };
      return fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": tok }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Couldn't save. Try again."); }); })
        .then(function () { return api("?a=crew&e=" + encodeURIComponent(hub)); })
        .then(function (r) { hubData = r; lu = null; luDirty = false; luRedraw(); $("lmsg").textContent = "Draft saved. It stays private until Dylan publishes."; })
        .catch(function (err) { t.disabled = false; $("lmsg").textContent = err.message; });
    }
    var n = +t.getAttribute("data-ln"), i = +t.getAttribute("data-la"), acts = L[n].acts;
    if (t.hasAttribute("data-ldel")) acts.splice(i, 1);
    else { var j = i + (+t.getAttribute("data-lmv")); if (j < 0 || j >= acts.length) return; var x = acts[i]; acts[i] = acts[j]; acts[j] = x; }
    luDirty = true; luRedraw();
  });
  // ---- door app: open it, set the PIN, send it to the door crew ----
  var newPin = "";
  function doorHtml(r) {
    var d = r.door, link = d.link.replace(/^https?:\/\//, "");
    return '<section class="hs" id="dsec"><h3>Door app</h3>' +
      '<p class="lnote">Your door crew scans tickets and finds people by name with this. It\'s for this show only.</p>' +
      '<div class="dgrid"><button type="button" class="mbtn dopen" data-dooropen>Open the door app</button>' +
      '<button type="button" class="obtn" data-doorsend>Send to your door crew</button></div>' +
      '<div class="sfield dlink"><span>' + esc(link) + '</span><button type="button" data-copy="' + esc(d.link) + '">Copy</button></div>' +
      '<form id="pinform" class="pinrow" novalidate><label for="dpin">' + (d.has_pin ? "Door PIN is set. Change it:" : "Set a door PIN so your crew can sign in:") + "</label>" +
      '<span class="pinin"><input id="dpin" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="4 to 8 numbers" value="' + esc(newPin) + '">' +
      '<button class="obtn" type="submit">' + (d.has_pin ? "Change PIN" : "Set PIN") + "</button></span>" +
      (d.has_pin ? '<span class="pinhelp">Changing it stops the old PIN from working. Phones already signed in stay in.</span>' : "") +
      '<p class="msg" id="dmsg" role="status"></p></form></section>';
  }
  function crewPost(body) {
    body.e = hub;
    return fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": tok }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong. Try again."); return j; }); });
  }
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "pinform") return;
    e.preventDefault();
    var pin = $("dpin").value.replace(/\D/g, ""), m = $("dmsg");
    if (pin.length < 4) { m.textContent = "Use 4 to 8 numbers."; return; }
    if (hubData.door.has_pin && !window.confirm("Change the door PIN to " + pin + "? The old PIN stops working.")) return;
    m.textContent = "Saving...";
    crewPost({ a: "door_pin", pin: pin }).then(function () {
      newPin = pin; hubData.door.has_pin = true;
      var sec = $("dsec"); sec.outerHTML = doorHtml(hubData);
      $("dmsg").textContent = "Door PIN set to " + pin + ". Send it to your door crew with the link.";
    }).catch(function (err) { m.textContent = err.message; });
  });
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-dooropen],[data-doorsend],[data-doorlist],[data-doorcsv]"); if (!t || !hubData) return;
    if (t.hasAttribute("data-dooropen")) {
      t.disabled = true; t.textContent = "Opening...";
      return crewPost({ a: "door_open" }).then(function (j) {
        try { localStorage.setItem("stack_door_" + hub, j.token); } catch (x) {}
        location.href = hubData.door.link.replace(/^https?:\/\/[^/]+/, "");
      }).catch(function (err) { t.disabled = false; t.textContent = "Open the door app"; window.alert(err.message); });
    }
    if (t.hasAttribute("data-doorsend")) {
      var msg = "Door app for " + hubData.show + ": " + hubData.door.link + (newPin ? "\nPIN: " + newPin : hubData.door.has_pin ? "\nI'll send you the PIN." : "");
      if (navigator.share) return navigator.share({ title: "Door app", text: msg }).catch(function () {});
      return copyText(msg).then(function () { t.textContent = "Copied. Paste it in a text"; setTimeout(function () { t.textContent = "Send to your door crew"; }, 2500); });
    }
    var rows = doorRows(hubData);
    if (t.hasAttribute("data-doorcsv")) return downloadCsv(rows);
    openDoorList(rows);
  });
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt);
    var ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (x) {} document.body.removeChild(ta); return Promise.resolve();
  }
  // Everyone who can get in, one row per night they're good for, A to Z.
  function doorRows(r) {
    var out = [];
    var add = function (list, kind) {
      list.forEach(function (p) {
        var label = kind === "Artist" ? "Artist" : kind === "Guest" ? (/^Guest of /.test(p.list || "") ? p.list : (p.list ? p.list + "'s list" : "Guest list")) : p.what || "Ticket";
        (p.nights && p.nights.length ? p.nights : r.nights).forEach(function (n) {
          out.push({ night: n, name: p.name || "", stage: p.stage || "", kind: kind, label: label, phone: p.phone || "", email: p.email || "", count: p.tickets || 1, in: p.checked_in || 0 });
        });
      });
    };
    add(r.artist_people || [], "Artist"); add(r.guests || [], "Guest"); add(r.buyers || [], "Ticket");
    var order = r.nights || [];
    return out.sort(function (a, b) { return order.indexOf(a.night) - order.indexOf(b.night) || (a.stage || a.name).localeCompare(b.stage || b.name); });
  }
  function downloadCsv(rows) {
    var q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [["Night", "Name", "Artist name", "Type", "Tickets", "Phone", "Email", "Checked in"].join(",")].concat(rows.map(function (x) {
      return [x.night, x.name, x.stage, x.label, x.count, phoneFmt(x.phone), x.email, x.in ? "Yes" : ""].map(q).join(",");
    }));
    var blob = new Blob([lines.join("\n")], { type: "text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = (hubData.slug || "show") + "-door-list.csv"; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function openDoorList(rows) {
    var byNight = {}; rows.forEach(function (x) { (byNight[x.night] = byNight[x.night] || []).push(x); });
    var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Door list: ' + esc(hubData.show) + "</title><style>" +
      "body{font:14px/1.35 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;margin:24px;max-width:820px}" +
      "h1{font-size:20px;margin:0 0 4px}p.s{margin:0 0 16px;color:#555}h2{font-size:16px;margin:22px 0 6px;padding-bottom:4px;border-bottom:2px solid #111}" +
      "table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:7px 6px;border-bottom:1px solid #ddd;vertical-align:top}th{font-size:12px;color:#555;font-weight:600}" +
      "td.b{width:22px}td.b span{display:inline-block;width:14px;height:14px;border:1.5px solid #111;border-radius:2px}td.b span.on{background:#111}" +
      "small{display:block;color:#666}.t{white-space:nowrap}button{font:inherit;padding:8px 14px;margin:0 0 12px;cursor:pointer}" +
      "@media print{button{display:none}body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body>" +
      '<button onclick="print()">Print</button><h1>' + esc(hubData.show) + '</h1><p class="s">Door list, ' + rows.length + " entries. Printed " + new Date().toLocaleString() + ". Filled box = already checked in.</p>" +
      Object.keys(byNight).map(function (n) {
        var list = byNight[n];
        return "<h2>" + esc(n) + " (" + list.reduce(function (a, x) { return a + x.count; }, 0) + ")</h2><table><thead><tr><th></th><th>Name</th><th>Type</th><th>Phone</th></tr></thead><tbody>" +
          list.map(function (x) {
            return '<tr><td class="b"><span' + (x.in ? ' class="on"' : "") + "></span></td><td><b>" + esc(x.stage || x.name) + "</b>" + (x.stage && x.name && x.stage !== x.name ? "<small>" + esc(x.name) + "</small>" : "") +
              "</td><td>" + esc(x.label) + (x.count > 1 ? " ×" + x.count : "") + '</td><td class="t">' + esc(phoneFmt(x.phone)) + "</td></tr>";
          }).join("") + "</tbody></table>";
      }).join("") + "</body></html>";
    var w = window.open("", "_blank");
    if (!w) { window.alert("Allow pop-ups for this site to open the door list."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }
  document.addEventListener("click", function (e) {
    var j = e.target.closest && e.target.closest("[data-jump]"); if (!j) return;
    var el = $(j.getAttribute("data-jump")); if (!el) return;
    e.preventDefault();
    var y = el.getBoundingClientRect().top + window.pageYOffset - 60;
    window.scrollTo({ top: y, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
  function artistForm() {
    return '<details class="gadd"' + (aOpen ? " open" : "") + '><summary class="mbtn">Add an artist</summary><form id="aform" class="cform" novalidate>' +
      '<p class="mnow">Their artist pass is emailed right away, with their own guest spots and sell link. Adding them here doesn\'t put them on the public lineup.</p>' +
      '<label for="aname">Artist name</label><input id="aname" autocomplete="off" maxlength="80" placeholder="How it shows on the lineup">' +
      '<label for="afull">Their full name</label><input id="afull" autocomplete="off" maxlength="80" placeholder="First and last">' +
      '<label for="aphone">Phone</label><input id="aphone" type="tel" inputmode="tel" autocomplete="off" maxlength="20" placeholder="(309) 555-0123">' +
      '<label for="aemail">Email</label><input id="aemail" type="email" inputmode="email" autocomplete="off" maxlength="254" placeholder="Where their pass goes">' +
      '<label for="aspots">Guest spots</label><input id="aspots" type="number" inputmode="numeric" min="0" max="10" value="2">' +
      '<details class="aduo"><summary>Duo or group? Add the second person</summary>' +
      '<p class="mnow">They get their own pass and link to the same artist page: one profile, one guest list (the spots above are shared), one set of tracks.</p>' +
      '<label for="a2full">Their full name</label><input id="a2full" autocomplete="off" maxlength="80" placeholder="First and last">' +
      '<label for="a2phone">Phone</label><input id="a2phone" type="tel" inputmode="tel" autocomplete="off" maxlength="20" placeholder="(309) 555-0123">' +
      '<label for="a2email">Email</label><input id="a2email" type="email" inputmode="email" autocomplete="off" maxlength="254" placeholder="Where their pass goes"></details>' +
      '<button class="mbtn" type="submit" id="ago">Add and send pass</button><p class="msg" id="amsg" role="status"></p></form></details>';
  }
  var aOpen = false;
  function artistFn(a, body) {
    body.a = a; body.e = hub;
    return fetch((C.supabaseUrl || "") + "/functions/v1/artist", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": tok }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong. Try again."); return j; }); });
  }
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "aform") return;
    e.preventDefault();
    var name = $("aname").value.trim(), full = $("afull").value.trim(), phone = $("aphone").value.trim(), email = $("aemail").value.trim(), spots = $("aspots").value;
    var m = $("amsg");
    if (!name) { m.textContent = "Add the artist name, how it shows on the lineup."; return; }
    if (full.split(/\s+/).length < 2) { m.textContent = "Enter their full name (first and last)."; return; }
    if (phone.replace(/\D/g, "").length < 10) { m.textContent = "Enter a phone number we can reach them at."; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { m.textContent = "Enter the email their pass should go to."; return; }
    $("ago").disabled = true; m.textContent = "Adding...";
    var f2 = $("a2full").value.trim(), p2 = $("a2phone").value.trim(), e2 = $("a2email").value.trim(), member = null;
    if (f2 || p2 || e2) {
      if (f2.split(/\s+/).length < 2) { m.textContent = "Second person: enter their full name (first and last)."; return; }
      if (p2.replace(/\D/g, "").length < 10) { m.textContent = "Second person: enter a phone number."; return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e2)) { m.textContent = "Second person: enter the email their pass should go to."; return; }
      member = { full_name: f2, phone: p2, email: e2 };
    }
    artistFn("crew_create", { name: name, full_name: full, phone: phone, email: email, spots: spots, member: member }).then(function (j) {
      aOpen = true;
      return api("?a=crew&e=" + encodeURIComponent(hub)).then(function (r) { hubData = r; drawHub();
        $("amsg").textContent = name + " is on the show." + (j.pass_sent ? " Their pass is on its way to " + email + "." : " The pass email didn't send; I can resend it.") +
          (j.member_error ? " " + j.member_error + " Add them with Add a member." : j.member_pass_sent ? " " + f2 + "'s pass is on its way to " + e2 + "." : member ? " " + f2 + "'s pass email didn't send." : ""); });
    }).catch(function (err) { m.textContent = err.message; $("ago").disabled = false; });
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-off]");
    if (!b) return;
    if (!window.confirm("Take " + b.getAttribute("data-offname") + " off this show? Their artist pass and their guests' tickets will stop working.")) return;
    b.disabled = true; b.textContent = "Taking off...";
    artistFn("crew_revoke", { id: b.getAttribute("data-off") }).then(function () { return reloadHub(); })
      .catch(function (err) { b.disabled = false; b.textContent = "Take off show"; window.alert(err.message); });
  });
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-madd],[data-mrm]"); if (!t) return;
    if (t.hasAttribute("data-mrm")) {
      if (!window.confirm("Take " + t.getAttribute("data-mname") + " off this act? Their artist pass will stop working.")) return;
      t.disabled = true;
      return artistFn("crew_member_remove", { id: t.getAttribute("data-act"), member_id: t.getAttribute("data-mrm") }).then(function () { return reloadHub(); })
        .catch(function (err) { t.disabled = false; window.alert(err.message); });
    }
    var row = t.closest(".arow"), open = row.nextElementSibling && row.nextElementSibling.classList.contains("mform");
    document.querySelectorAll(".mform").forEach(function (x) { x.remove(); });
    if (open) return;
    var id = t.getAttribute("data-madd"), act = t.getAttribute("data-act-name");
    row.insertAdjacentHTML("afterend", '<form class="cform mform" data-act="' + esc(id) + '" novalidate><p class="mnow">Add someone else who performs as ' + esc(act) +
      '. They get their own pass and link to the same artist page: one profile, one shared guest list, one set of tracks.</p>' +
      '<label>Their full name<input name="full" autocomplete="off" maxlength="80" placeholder="First and last"></label>' +
      '<label>Phone<input name="phone" type="tel" inputmode="tel" autocomplete="off" maxlength="20" placeholder="(309) 555-0123"></label>' +
      '<label>Email<input name="email" type="email" inputmode="email" autocomplete="off" maxlength="254" placeholder="Where their pass goes"></label>' +
      '<button class="mbtn" type="submit">Add and send pass</button><p class="msg" role="status"></p></form>');
    row.nextElementSibling.querySelector("input").focus();
  });
  document.addEventListener("submit", function (e) {
    var f = e.target; if (!f.classList || !f.classList.contains("mform")) return;
    e.preventDefault();
    var full = f.full.value.trim(), phone = f.phone.value.trim(), email = f.email.value.trim(), m = f.querySelector(".msg");
    if (full.split(/\s+/).length < 2) { m.textContent = "Enter their full name (first and last)."; return; }
    if (phone.replace(/\D/g, "").length < 10) { m.textContent = "Enter a phone number we can reach them at."; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { m.textContent = "Enter the email their pass should go to."; return; }
    f.querySelector("button").disabled = true; m.textContent = "Adding...";
    artistFn("crew_member_add", { id: f.getAttribute("data-act"), full_name: full, phone: phone, email: email }).then(function (j) {
      return reloadHub().then(function () { window.alert(full + " is on the pass." + (j.pass_sent ? " Their pass is on its way to " + email + "." : " The pass email didn't send.")); });
    }).catch(function (err) { m.textContent = err.message; f.querySelector("button").disabled = false; });
  });
  function guestForm() {
    return '<details class="gadd"' + (gOpen ? " open" : "") + '><summary class="mbtn">Add a guest</summary><form id="gform" class="cform" novalidate>' +
      '<p class="mnow">They get a free 2-day ticket by email right away. It doesn\'t use any of the ' + "150 spots." + "</p>" +
      '<label for="gname">Full name</label><input id="gname" autocomplete="off" maxlength="80" placeholder="First and last">' +
      '<label for="gphone">Phone</label><input id="gphone" type="tel" inputmode="tel" autocomplete="off" maxlength="20" placeholder="(309) 555-0123">' +
      '<label for="gemail">Email</label><input id="gemail" type="email" inputmode="email" autocomplete="off" maxlength="254" placeholder="Where their ticket goes">' +
      '<label for="glist">Whose list</label><input id="glist" maxlength="40" value="' + esc(gList || (me && me.name) || "") + '">' +
      '<button class="mbtn" type="submit" id="ggo">Add and send ticket</button><p class="msg" id="gmsg" role="status"></p></form></details>';
  }
  var gOpen = false, gList = "", DOOR = (C.supabaseUrl || "") + "/functions/v1/door";
  function door(a, body) {
    return fetch(DOOR + "?a=" + a + "&e=" + encodeURIComponent(hub), { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": tok }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong. Try again."); return j; }); });
  }
  function reloadHub(msg) {
    return api("?a=crew&e=" + encodeURIComponent(hub)).then(function (r) { hubData = r; drawHub(); if (msg && $("gmsg")) $("gmsg").textContent = msg; });
  }
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "gform") return;
    e.preventDefault();
    var name = $("gname").value.trim(), phone = $("gphone").value.trim(), email = $("gemail").value.trim();
    gList = $("glist").value.trim();
    if (name.split(/\s+/).length < 2) { $("gmsg").textContent = "Enter their full name (first and last)."; return; }
    if (phone.replace(/\D/g, "").length < 10) { $("gmsg").textContent = "Enter a phone number we can reach them at."; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { $("gmsg").textContent = "Enter the email their ticket should go to."; return; }
    $("ggo").disabled = true; $("gmsg").textContent = "Adding...";
    door("crew_add", { name: name, phone: phone, email: email, list: gList }).then(function (j) {
      gOpen = true;
      return reloadHub(name + " is on the list." + (j.emailed ? " Their ticket is on its way to " + email + "." : " The ticket email didn't send; it's still on the door list."));
    }).catch(function (err) { $("gmsg").textContent = err.message; $("ggo").disabled = false; });
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-rm]");
    if (!b) return;
    if (!window.confirm("Take " + b.getAttribute("data-rmname") + " off the guest list? Their ticket will stop working at the door.")) return;
    b.disabled = true; b.textContent = "Removing...";
    door("crew_remove", { order_id: b.getAttribute("data-rm") }).then(function () { return reloadHub(); })
      .catch(function (err) { b.disabled = false; b.textContent = "Remove"; window.alert(err.message); });
  });
  function guestList(r) {
    var art = r.artist_people || [], g = r.guests || [], b = r.buyers || [];
    var sum = function (l, k) { return l.reduce(function (a, p) { return a + p[k]; }, 0); };
    var at = sum(art, "tickets"), gt = sum(g, "tickets");
    return '<section class="hs" id="hwho"><h3>Who\'s coming</h3><p class="lede small"><b>' + at + "</b> " + (at === 1 ? "artist" : "artists") + ", <b>" + gt + "</b> " + (gt === 1 ? "guest" : "guests") + ", <b>" + sum(b, "tickets") + "</b> sold." + (function (n) { return n ? " <b>" + n + "</b> checked in." : ""; })(sum(art, "checked_in") + sum(g, "checked_in") + sum(b, "checked_in")) + "</p>" +
      '<div class="dlbtns"><button type="button" class="obtn" data-doorlist>Door list</button><button type="button" class="obtn" data-doorcsv>Download spreadsheet</button></div>' +
      (art.length + g.length + b.length > 6 ? '<input class="find" type="search" placeholder="Find someone by name, email or phone" aria-label="Find someone" data-findbox>' : "") +
      '<h4 class="gh">Artists (' + at + ")</h4>" + (art.length ? art.map(function (p) { return personRow(p, false); }).join("") : '<p class="mempty">No artist passes yet.</p>') +
      '<h4 class="gh">Guest list (' + gt + ")</h4>" + (g.length ? g.map(function (p) { return personRow(p, true); }).join("") : '<p class="mempty">Nobody on the guest list yet.</p>') +
      (r.can_add_guests ? guestForm() : "") +
      '<details class="buyers"' + (b.length && b.length <= 8 ? " open" : "") + '><summary>Ticket buyers (' + sum(b, "tickets") + ")</summary>" +
      (b.length ? b.map(function (p) { return personRow(p, false); }).join("") : '<p class="mempty">No tickets sold yet.</p>') + "</details></section>";
  }
  function drawHub() {
    var r = hubData, P = $("panes");
    if (!r) { P.innerHTML = '<p class="mempty">Loading the show...</p>'; return; }
    var qr = FN + "?a=qr&e=" + encodeURIComponent(r.slug);
    var max = Math.max.apply(null, r.last7.map(function (x) { return x.tickets; }).concat([1]));
    var week = r.last7.reduce(function (a, x) { return a + x.tickets; }, 0);
    var todo = r.checks.filter(function (c) { return !c.ok; });
    var nm = r.night_meters || [];
    // One bar per night. Only sold tickets fill it; artists and guests are noted but never take a spot.
    var meter = nm.map(function (n) {
      var pct = n.cap ? Math.min(100, Math.round(100 * n.sold / n.cap)) : 0;
      var why = n.parts.length ? "Sold: " + n.parts.map(function (p) { return esc(p.name) + " (" + p.sold + ")"; }).join(", ") : "Nothing sold yet";
      return '<div class="mtr"><div class="mtop"><b>' + esc(n.label) + "</b><span>" + n.sold + (n.cap ? " of " + n.cap + " sold" : " sold") + "</span></div>" +
        '<div class="mbar"><span class="seg" style="flex:1"><i style="width:' + pct + '%"></i></span></div>' +
        '<div class="mnow">' + (n.cap ? Math.max(0, n.cap - n.sold) + " spots left. " : "") + why + ".</div></div>";
    }).join("");
    // What each ticket costs right now, from its price ladder.
    var prices = (r.now_prices || []).map(function (t) {
      return "<li><b>" + esc(t.name) + "</b><span>" + (t.sold_out ? "Sold out" : usd(t.price_cents) + (t.tier && t.tier !== t.name ? " (" + esc(t.tier) + ")" : "") + ", " + (t.tier === t.name ? t.left + " left, price follows both nights" : t.left_at_price + " left at this price")) + "</span></li>";
    }).join("");
    // Show checklist: open and near the top when something's missing, folded into one line when it's all done.
    var checkList = '<ul class="checks">' + r.checks.slice().sort(function (a, b) { return a.ok - b.ok; }).map(function (c) { return '<li class="' + (c.ok ? "ok" : "no") + '">' + esc(c.label) + "</li>"; }).join("") + "</ul>";
    var checksHtml = todo.length
      ? '<section class="hs"><h3>' + todo.length + (todo.length === 1 ? " thing to fix before the show" : " things to fix before the show") + "</h3>" + checkList + "</section>"
      : '<section class="hs"><details class="allset"><summary>Show checklist: all ' + r.checks.length + " done</summary>" + checkList + "</details></section>";
    var lede = "<b>" + r.sold + "</b> " + (r.sold === 1 ? "ticket" : "tickets") + " sold for <b>" + usd(r.money_cents) + "</b>. " +
      "<b>" + r.artist_passes + "</b> " + (r.artist_passes === 1 ? "artist" : "artists") + " and <b>" + r.guest_count + "</b> " + (r.guest_count === 1 ? "guest" : "guests") + " on top of that" + (r.checked_in ? ", <b>" + r.checked_in + "</b> checked in" : "") + ".";
    P.innerHTML = '<div class="hub" style="--m:' + esc(r.colors.main) + ';--a:' + esc(r.colors.accent) + ';--d:' + esc(r.colors.deep) + '">' +
      '<button type="button" class="hback" data-back>All shows</button>' +
      '<header class="hhero"' + (r.image ? ' style="background-image:url(\'' + esc(r.image) + '\')"' : "") + '><div class="hcap">' +
        '<span class="state' + (r.on_sale ? " live" : "") + '">' + (r.on_sale ? "On sale" : "Not on sale yet") + "</span>" +
        "<h2>" + esc(r.show) + "</h2><p>" + esc(r.nights.join(" + ")) + "<br>" + esc([r.venue, r.city].filter(Boolean).join(", ")) + (r.age ? ", " + esc(r.age) : "") + "</p></div></header>" +
      '<nav class="hnav" aria-label="Jump to">' + [["hnum", "Numbers"], ["hshare", "Share"], r.door ? ["dsec", "Door"] : null, ["hart", "Artists"], r.lineup && r.lineup.length ? ["lsec", "Lineup"] : null, ["hwho", "Who's coming"]]
        .filter(Boolean).map(function (x) { return '<a href="#' + x[0] + '" data-jump="' + x[0] + '">' + x[1] + "</a>"; }).join("") + "</nav>" +
      '<section class="hs" id="hnum"><p class="lede">' + lede + "</p>" + meter +
        (prices ? '<h3 class="sub">Prices right now</h3><ul class="prices">' + prices + "</ul>" : "") +
        ((r.artist_passes || r.guest_count) ? '<p class="mnow">Artists and guests get in free and don\'t use any of the ' + (nm[0] && nm[0].cap ? nm[0].cap : "") + " spots.</p>" : "") +
        (r.tests ? '<p class="mnow">Test tickets are left out of every number here (' + r.tests + ").</p>" : "") + "</section>" +
      (todo.length ? checksHtml : "") +
      '<section class="hs" id="hshare"><h3>Share the show</h3><div class="share"><div class="sfield"><span>' + esc(r.link.replace(/^https?:\/\//, "")) + '</span><button type="button" data-copy="' + esc(r.link) + '">Copy</button></div>' +
        '<a class="qrbox" href="' + esc(qr) + '" target="_blank" rel="noopener" title="Open the QR code to save it"><img src="' + esc(qr) + '" alt="QR code for the show link" width="76" height="76"></a></div>' +
        '<a class="tlink" href="' + esc(r.link) + '" target="_blank" rel="noopener">Open the show page</a></section>' +
      (r.door ? doorHtml(r) : "") +
      (todo.length ? "" : checksHtml) +
      '<section class="hs" id="hart"><h3>Artists</h3>' + (r.artists.length ? r.artists.map(function (a) {
          return '<div class="arow">' + (a.photo ? '<img class="av" src="' + esc(a.photo) + '" alt="" loading="lazy">' : '<span class="av">' + esc(initials(a.name)) + "</span>") + '<span class="ainfo"><b>' + esc(a.name) + "</b><span>" + (a.claimed ? "Has their pass" : "Hasn't claimed their pass") + (a.taps ? ", " + a.taps + " link taps" : "") + "</span>" +
            ((a.members || []).length ? '<span class="amem">Also on this pass: ' + a.members.map(function (m) {
              return esc(m.name) + (a.id ? ' <button type="button" class="amx" data-mrm="' + esc(m.id) + '" data-act="' + esc(a.id) + '" data-mname="' + esc(m.name) + '" aria-label="Remove ' + esc(m.name) + '">Remove</button>' : "");
            }).join(", ") + "</span>" : "") +
            (a.id ? '<span class="alinks"><button type="button" class="aoff" data-madd="' + esc(a.id) + '" data-act-name="' + esc(a.name) + '">Add a member</button>' +
              '<button type="button" class="aoff" data-off="' + esc(a.id) + '" data-offname="' + esc(a.name) + '">Take off show</button></span>' : "") + "</span>" +
            '<span class="asold"><b>' + a.tickets + "</b>sold</span>" + (a.link ? '<button type="button" class="acopy" data-copy="' + esc(a.link) + '" aria-label="Copy ' + esc(a.name) + '\'s sell link">Copy link</button>' : "") + "</div>";
        }).join("") : '<p class="mempty">No artists yet.</p>') +
        (r.can_add_guests ? artistForm() : "") + "</section>" +
      (r.lineup && r.lineup.length ? '<section class="hs" id="lsec">' + lineupHtml() + "</section>" : "") +
      guestList(r) +
      '<section class="hs two"><div><h3>This week</h3><p class="lede small"><b>' + week + "</b> " + (week === 1 ? "ticket" : "tickets") + " in the last 7 days</p>" +
        '<div class="bars">' + r.last7.map(function (x) { return '<i style="height:' + Math.max(4, Math.round(100 * x.tickets / max)) + '%" title="' + x.tickets + '"></i>'; }).join("") + "</div>" +
        '<div class="barl">' + r.last7.map(function (x) { return "<span>" + new Date(x.day + "T12:00:00").toLocaleDateString("en-US", { weekday: "narrow" }) + "</span>"; }).join("") + "</div></div>" +
        '<div><h3>Playlist</h3><p class="lede small">' + (r.playlist.artist_tracks + r.playlist.tracks
          ? "<b>" + (r.playlist.artist_tracks + r.playlist.tracks) + "</b> " + (r.playlist.artist_tracks + r.playlist.tracks === 1 ? "track" : "tracks") + " playing on the show page" + (r.playlist.mode === "subduction" ? ", plus Subduction picks" : "")
          : "Subduction picks are playing on the show page. Artists can add their own tracks from their pass.") + "</p></div></section>" +
      "</div>";
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var b = e.target.closest("[data-hub]");
    if (b) {
      hub = b.getAttribute("data-hub"); hubData = null; lu = null; luDirty = false; drawHub(); window.scrollTo(0, 0);
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
