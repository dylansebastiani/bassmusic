/* Door app: scan tickets, find people by name, run the guest list, watch sales.
   Door staff use the show's PIN (scan + find only). Staff signed in on /admin get everything. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/door";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var usd = function (c) { return "$" + (c / 100).toFixed(c % 100 ? 2 : 0); };
  var slug = (new URLSearchParams(location.search).get("e") || "underground").replace(/[^a-z0-9-]/gi, "").toLowerCase();
  var DKEY = "stack_door_" + slug, admin = null, door = null;
  try { admin = localStorage.getItem("stack_admin"); door = localStorage.getItem(DKEY); } catch (e) {}
  var me = null, night = null, tab = "scan";
  // Offline mode (door-offline.js): only used when the server turns it on and a request fails for lack of signal.
  var OFF = window.DoorOffline ? window.DoorOffline(slug) : null, offOn = false;
  var netErr = function (err) { return offOn && OFF.ready() && !err.status; };

  function call(a, body, params, ms) {
    var o = { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" } };
    // A scan in a weak-signal doorway shouldn't hang: with offline mode ready, give up after ms and check the copy on the phone.
    if (ms && window.AbortController) { var ac = new AbortController(); o.signal = ac.signal; setTimeout(function () { ac.abort(); }, ms); }
    if (admin) o.headers["x-admin-token"] = admin;
    if (door) o.headers["x-door-token"] = door;
    if (body) o.body = JSON.stringify(body);
    var qs = "?e=" + slug + "&a=" + a + Object.keys(params || {}).map(function (k) { return "&" + k + "=" + encodeURIComponent(params[k]); }).join("");
    return fetch(FN + qs, o).then(function (r) {
      return r.json().then(function (j) {
        if (r.status === 401) { signOut(true); }
        if (!r.ok) throw Object.assign(new Error(j.error || "request failed"), { status: r.status });
        return j;
      });
    });
  }
  function signOut(silent) {
    try { localStorage.removeItem(DKEY); } catch (e) {}
    door = null;
    if (!silent) { location.reload(); return; }
    $("app").hidden = true; $("tabs").hidden = true; $("login").hidden = false;
  }
  $("signout").addEventListener("click", function () {
    if (OFF && OFF.pending() && !confirm(OFF.pending() + " check-ins on this phone haven't been sent yet. They send after you sign back in. Sign out?")) return;
    signOut(false);
  });

  $("pf").addEventListener("submit", function (e) {
    e.preventDefault(); $("lmsg").textContent = "Checking...";
    admin = null;
    call("pin", { pin: $("pin").value }).then(function (r) { door = r.token; try { localStorage.setItem(DKEY, door); } catch (x) {} boot(); })
      .catch(function (err) { $("lmsg").textContent = err.message; try { admin = localStorage.getItem("stack_admin"); } catch (x) {} });
  });

  // Tonight = the night whose doors-to-close window we're in (with a few hours either side), else the next one.
  function pickNight(ns) {
    var now = Date.now(), best = null;
    ns.forEach(function (n) {
      var s = new Date(n.starts_at).getTime() - 6 * 3600e3, e = new Date(n.ends_at || n.starts_at).getTime() + 3 * 3600e3;
      if (now >= s && now <= e) best = n;
    });
    if (best) return best.id;
    var up = ns.filter(function (n) { return new Date(n.starts_at).getTime() > now; });
    return (up[0] || ns[ns.length - 1] || {}).id;
  }

  function boot() {
    call("me").then(start).catch(function (err) {
      // No signal at sign-in: a phone that was signed in and has the list opens from its copy.
      var cm = OFF && OFF.ready() && (door || admin) && !err.status ? OFF.cachedMe() : null;
      if (cm) { offOn = true; start(cm, true); return; }
      if (err.status === 401 || err.status === 403) { $("login").hidden = false; $("lmsg").textContent = admin ? "Your staff sign-in doesn't cover this. Use the door PIN." : ""; admin = null; }
      else { $("login").hidden = false; $("lmsg").textContent = err.message; }
    });
  }
  function start(d, fromCopy) {
      me = d;
      if (OFF && !fromCopy) {
        if (d.offline) { offOn = true; OFF.saveMe(d); getList(); keepPage(true); }
        else { offOn = false; OFF.forget(); keepPage(false); }
      } $("login").hidden = true; $("app").hidden = false; $("tabs").hidden = false; $("signout").hidden = !door;
      $("ename").textContent = d.event.name + (d.admin ? " · staff" : " · door");
      Array.prototype.forEach.call(document.querySelectorAll(".adm"), function (b) { b.hidden = !d.admin; });
      if (!d.admin) $("tabs").style.gridTemplateColumns = "1fr 1fr";
      night = pickNight(d.nights);
      $("nights").innerHTML = d.nights.map(function (n, i) {
        return '<button type="button" class="' + (i % 2 ? "n2" : "") + '" data-n="' + n.id + '" aria-pressed="' + (n.id === night) + '"><img class="eye" src="assets/toftu/eye-' + (i % 2 ? "sat" : "fri") + '.webp" alt="" width="240" height="240">' + esc(n.label) + "</button>";
      }).join("");
      $("gtype").innerHTML = d.types.map(function (t) { return '<option value="' + t.slug + '">' + esc(t.name) + "</option>"; }).join("");
      count(); offBar();
      if (d.admin) { guests(); sales(); }
  }
  $("nights").addEventListener("click", function (e) {
    var b = e.target.closest("[data-n]"); if (!b) return;
    night = b.getAttribute("data-n");
    Array.prototype.forEach.call($("nights").children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    count(); if (tab === "find") find();
  });
  function count() {
    var draw = function (c) { $("count").innerHTML = "<span>In <b>" + c.inside + "</b> / " + c.expected + "</span><span>Guest list " + c.comps + "</span>"; };
    call("count", null, { n: night }).then(draw).catch(function (err) { if (netErr(err)) draw(OFF.count(night)); });
  }
  setInterval(function () { if (me && !document.hidden) count(); }, 20000);

  $("tabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-tab]"); if (!b) return;
    tab = b.getAttribute("data-tab");
    ["scan", "find", "guests", "sales"].forEach(function (n) { $("p-" + n).hidden = n !== tab; });
    Array.prototype.forEach.call(document.querySelectorAll("#tabs [data-tab]"), function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); });
    if (tab !== "scan") stopCam();
    if (tab === "sales") sales();
    if (tab === "guests") guests();
    if (tab === "find") find();
  });

  // ---------- the result screen: full-color, big, can't be misread across a dark doorway ----------
  var hideT = null;
  function show(r) {
    var cls = "bad", h = "No", p = "", s = "";
    if (r.result === "ok") { cls = "ok"; h = "In"; p = r.name || ""; s = (r.type || "") + (r.comp ? " · guest list" + (r.list ? " (" + r.list + ")" : "") : ""); }
    else if (r.result === "used") { cls = "warn"; h = "Used"; p = r.name || ""; s = "Already scanned" + (r.scanned_at ? " at " + new Date(r.scanned_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""); }
    else if (r.result === "wrong_night") { h = "Wrong night"; p = r.name || ""; s = "Good for " + (r.good_for || "another night"); }
    else if (r.result === "void") { h = "Void"; p = r.name || ""; s = "Refunded or removed"; }
    else { h = "Not found"; s = r.offline ? "Not on this phone's list. New tickets show up once signal is back." : "Not a ticket for this show. Try typing the code."; }
    if (r.offline && r.result === "ok") s += (s ? " · " : "") + "saved on this phone";
    var el = $("result");
    el.className = "result " + cls; el.innerHTML = "<h2>" + esc(h) + "</h2><p>" + esc(p) + "</p><small>" + esc(s) + "</small><small style='margin-top:20px;opacity:.7'>Tap to keep going</small>";
    el.hidden = false;
    try { navigator.vibrate && navigator.vibrate(r.result === "ok" ? 80 : [200, 80, 200]); } catch (e) {}
    clearTimeout(hideT); hideT = setTimeout(hide, r.result === "ok" ? 1600 : 4000);
    if (r.result === "ok") count();
    offBar();
  }
  function hide() { $("result").hidden = true; }
  $("result").addEventListener("click", hide);

  var busy = false, last = "", lastAt = 0;
  function scan(q) {
    if (busy || !q) return;
    if (q === last && Date.now() - lastAt < 4000) return;
    busy = true; last = q; lastAt = Date.now();
    var n = night, off = offOn && OFF.ready();
    // Offline ready: a ticket this phone let in but hasn't sent yet is Used, and no signal at all skips the wait.
    var first = off ? OFF.queued(q, n) : Promise.resolve(null);
    first.then(function (held) {
      if (held) return show(held);
      if (off && navigator.onLine === false) return OFF.scan(q, n, false).then(show);
      return call("scan", { night: n, q: q }, null, off ? 6000 : 0).then(function (r) { if (OFF) OFF.noteLive(r, n); show(r); })
        .catch(function (err) {
          if (netErr(err)) return OFF.scan(q, n, true).then(show);
          $("smsg").textContent = err.message + " (no signal? use Find by name)";
        });
    }).then(function () { busy = false; }, function () { busy = false; });
  }
  $("mf").addEventListener("submit", function (e) { e.preventDefault(); scan($("mcode").value); $("mcode").value = ""; });

  // ---------- camera: the phone's own QR reader where it has one, jsQR on iPhone ----------
  var stream = null, raf = null, detector = null, canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    return new Promise(function (ok, no) { var s = document.createElement("script"); s.src = "assets/vendor/jsqr.min.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  }
  function startCam() {
    $("smsg").textContent = "";
    var ready = ("BarcodeDetector" in window) ? window.BarcodeDetector.getSupportedFormats().then(function (f) {
      if (f.indexOf("qr_code") >= 0) detector = new window.BarcodeDetector({ formats: ["qr_code"] }); else return loadJsQR();
    }).catch(loadJsQR) : loadJsQR();
    ready.then(function () { return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false }); })
      .then(function (s) {
        stream = s; var v = $("video"); v.srcObject = s; v.play();
        $("startCam").hidden = true; $("aim").hidden = false; tick();
      }).catch(function () { $("smsg").textContent = "Camera blocked. Allow camera access for this site in your browser settings, or type codes below."; });
  }
  function stopCam() {
    if (raf) cancelAnimationFrame(raf); raf = null;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null;
    $("startCam").hidden = false; $("aim").hidden = true;
  }
  var lastFrame = 0;
  function tick(ts) {
    raf = requestAnimationFrame(tick);
    var v = $("video");
    if (!stream || v.readyState < 2 || busy || !$("result").hidden || (ts && ts - lastFrame < 200)) return;
    lastFrame = ts || 0;
    if (detector) {
      detector.detect(v).then(function (codes) { if (codes[0]) scan(codes[0].rawValue); }).catch(function () {});
    } else if (window.jsQR) {
      var w = 480, h = Math.round(w * v.videoHeight / v.videoWidth) || 480;
      canvas.width = w; canvas.height = h; ctx.drawImage(v, 0, 0, w, h);
      var r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
      if (r && r.data) scan(r.data);
    }
  }
  $("startCam").addEventListener("click", startCam);
  document.addEventListener("visibilitychange", function () { if (document.hidden) stopCam(); });

  // ---------- find by name ----------
  var ft = null;
  $("fq").addEventListener("input", function () { clearTimeout(ft); ft = setTimeout(find, 250); });
  function person(r, actions) {
    return '<div class="person' + (r.in_at ? " in" : "") + '"><b>' + esc(r.name || "(no name)") + "</b>" +
      "<small>" + esc(r.type || "") + " · " + esc(r.code) + (r.comp ? ' · <span class="tag">guest list' + (r.list ? ": " + esc(r.list) : "") + "</span>" : "") +
      (r.in_at ? " · in " + new Date(r.in_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "") + (r.status === "void" ? " · VOID" : "") + "</small>" + actions + "</div>";
  }
  // Find tab: the whole list for the night (A to Z), each row clearly IN or NOT SCANNED.
  // Typing narrows it; the filter buttons show everyone, only who's not in yet, or only who's in.
  var fFilter = "all", fRows = [];
  function badge(r) {
    return r.in_at ? '<span class="badge in">&#10003; IN ' + new Date(r.in_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + "</span>"
      : '<span class="badge out">NOT SCANNED</span>';
  }
  function drawFound() {
    var nIn = fRows.filter(function (r) { return r.in_at; }).length;
    $("fcAll").textContent = fRows.length; $("fcIn").textContent = nIn; $("fcOut").textContent = fRows.length - nIn;
    var rows = fRows.filter(function (r) { return fFilter === "all" || (fFilter === "in" ? r.in_at : !r.in_at); });
    $("found").innerHTML = rows.length ? rows.map(function (r) {
      return person(r, badge(r) + (r.status === "void" ? "" : r.in_at ? '<button type="button" data-undo="' + r.ticket_id + '">Undo</button>' : '<button type="button" data-in="' + r.ticket_id + '">Check in</button>'));
    }).join("") : '<div class="empty">' + (fRows.length ? "Nobody here." : $("fq").value.trim() ? "Nobody by that name for this night." : "No tickets for this night yet.") + "</div>";
  }
  function find() {
    var qv = $("fq").value.trim();
    if (qv.length === 1) return;
    call("search", null, { n: night, q: qv }).then(function (d) { fRows = d.results || []; drawFound(); })
      .catch(function (err) {
        if (netErr(err)) { fRows = OFF.search(qv, night); drawFound(); return; }
        $("found").innerHTML = '<div class="empty">' + esc(err.message) + "</div>";
      });
  }
  $("ffilter").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    fFilter = b.getAttribute("data-f");
    [].forEach.call(this.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    drawFound();
  });
  $("found").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var id = b.getAttribute("data-in") || b.getAttribute("data-undo"), isIn = !!b.getAttribute("data-in"), n = night;
    b.disabled = true;
    var done = function (r) { if (r.result !== "undone") show(r); count(); find(); };
    // Undo a check-in this phone hasn't sent yet: just drop it, nothing to tell the server.
    if (!isIn && OFF && OFF.undo(id, n)) { done({ result: "undone" }); offBar(); return; }
    call(isIn ? "checkin" : "undo", { night: n, ticket_id: id }, null, offOn && OFF.ready() ? 6000 : 0)
      .then(function (r) { if (OFF) OFF.noteLive(r.result === "undone" ? { result: "undone", ticket_id: id } : r, n); done(r); })
      .catch(function (err) {
        if (netErr(err) && isIn) return OFF.checkin(id, n, true).then(done);
        b.disabled = false; alertMsg(netErr(err) ? "Undo needs signal." : err.message);
      });
  });
  function alertMsg(m) { $("smsg").textContent = m; }

  // ---------- guest list ----------
  function guests() {
    call("guests").then(function (d) {
      $("guests").innerHTML = d.guests.length ? d.guests.map(function (g) {
        return person({ name: g.name, type: g.type, code: g.code, comp: true, list: g.list },
          '<button type="button" data-void="' + g.ticket_id + '" style="background:none;color:var(--mute);border:1px solid var(--line)">Remove</button>');
      }).join("") : '<div class="empty">No one on the list yet.</div>';
    }).catch(function () {});
  }
  $("gf").addEventListener("submit", function (e) {
    e.preventDefault();
    var people = $("gnames").value.split(/\n+/).map(function (l) {
      var p = l.split(","); return { name: (p[0] || "").trim(), email: (p[1] || "").trim() || null };
    }).filter(function (p) { return p.name; });
    if (!people.length) { $("gmsg").textContent = "Add at least one name."; return; }
    $("gmsg").textContent = "Adding...";
    call("comp", { type: $("gtype").value, list: $("glist").value.trim() || null, people: people }).then(function (r) {
      $("gmsg").textContent = "Added " + r.added + (r.emailed ? ", emailed " + r.emailed : "") + "."; $("gnames").value = ""; guests(); count();
    }).catch(function (err) { $("gmsg").textContent = err.message; });
  });
  $("guests").addEventListener("click", function (e) {
    var b = e.target.closest("[data-void]"); if (!b) return;
    if (!confirm("Take this person off the list? Their ticket stops working.")) return;
    call("void", { ticket_id: b.getAttribute("data-void") }).then(function () { guests(); count(); }).catch(function (err) { $("gmsg").textContent = err.message; });
  });

  // ---------- sales ----------
  function sales() {
    call("sales").then(function (d) {
      var sold = d.by_type.reduce(function (s, t) { return s + t.sold; }, 0);
      $("sstats").innerHTML = [["Gross", usd(d.gross_cents)], ["Tickets sold", sold], ["Orders", d.orders], ["Refunded", d.refunded]]
        .map(function (x) { return '<div class="stat"><b>' + x[1] + "</b><span>" + x[0] + "</span></div>"; }).join("");
      $("stypes").innerHTML = d.by_type.map(function (t) {
        return '<div class="sub mono">' + esc(t.name) + " · " + t.sold + " sold" + (t.comps ? " + " + t.comps + " guest list" : "") +
          (t.now && t.now.tier ? " · now " + esc(t.now.tier.name) + " (" + t.now.tier.left + " left)" : t.now && t.now.sold_out ? " · SOLD OUT" : "") + "</div>" +
          '<div class="tablewrap"><table><thead><tr><th>Tier</th><th class="num">Price</th><th class="num">Sold</th><th class="num">Of</th></tr></thead><tbody>' +
          t.tiers.map(function (r) { return "<tr><td>" + esc(r.name) + '</td><td class="num">' + usd(r.price_cents) + '</td><td class="num">' + r.sold + '</td><td class="num">' + r.qty + "</td></tr>"; }).join("") +
          "</tbody></table></div>";
      }).join("");
      $("salesState").textContent = d.sales_open ? "Ticket sales are ON" : "Ticket sales are OFF";
      $("salesBtn").textContent = d.sales_open ? "Turn off" : "Turn on";
      $("salesBtn").setAttribute("data-open", d.sales_open ? "1" : "0");
      $("ptable").querySelector("tbody").innerHTML = d.promos.length ? d.promos.map(function (p) {
        return "<tr><td>" + esc(p.code) + "</td><td>" + esc(p.label || "") + '</td><td class="num">' + (p.discount_cents ? usd(p.discount_cents) : "-") + '</td><td class="num">' + p.orders + '</td><td class="num">' + p.tickets + "</td></tr>";
      }).join("") : '<tr><td colspan="5">No codes yet.</td></tr>';
      $("otable").querySelector("tbody").innerHTML = d.recent.length ? d.recent.map(function (o) {
        return "<tr><td>" + esc(o.name) + '</td><td class="num">' + o.qty + '</td><td class="num">' + usd(o.total_cents) + "</td><td>" + esc(o.promo || "") + "</td><td>" + new Date(o.paid_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + "</td></tr>";
      }).join("") : '<tr><td colspan="5">No orders yet.</td></tr>';
    }).catch(function () {});
  }
  $("salesBtn").addEventListener("click", function () {
    var open = $("salesBtn").getAttribute("data-open") !== "1";
    if (!confirm(open ? "Turn ticket sales ON? The page starts selling right away." : "Turn ticket sales OFF?")) return;
    call("settings", { sales_open: open }).then(sales).catch(function (err) { alert(err.message); });
  });
  $("pinf").addEventListener("submit", function (e) {
    e.preventDefault();
    call("settings", { pin: $("newpin").value }).then(function () { $("newpin").value = ""; alert("PIN saved. Give it to your door staff."); }).catch(function (err) { alert(err.message); });
  });
  $("promof").addEventListener("submit", function (e) {
    e.preventDefault();
    call("promo", { code: $("pcode").value, label: $("plabel").value, discount_dollars: $("poff").value }).then(function () {
      $("pmsg").textContent = "Saved. Link: " + location.origin + "/tickets.html?e=" + slug + "&code=" + encodeURIComponent($("pcode").value.toUpperCase());
      $("pcode").value = ""; $("plabel").value = ""; $("poff").value = "0"; sales();
    }).catch(function (err) { $("pmsg").textContent = err.message; });
  });

  // ---------- offline mode ----------
  // Keep a fresh copy of the list while there's signal (every 2 minutes), and send saved check-ins as soon as it's back.
  function getList() {
    if (!offOn || document.hidden) return;
    call("offline").then(function (d) { OFF.setList(d); offBar(); }).catch(function () {});
  }
  setInterval(getList, 120000);
  var syncing = false;
  function sendSaved() {
    if (!OFF || syncing || !OFF.pending() || !(door || admin) || navigator.onLine === false) return;
    syncing = true;
    OFF.sync(function (body) { return call("sync", body); })
      .then(function (n) { syncing = false; offBar(); if (n) { count(); if (tab === "find") find(); if (OFF.pending()) sendSaved(); } },
            function () { syncing = false; offBar(); });
  }
  setInterval(sendSaved, 15000);
  window.addEventListener("online", function () { sendSaved(); getList(); count(); offBar(); });
  window.addEventListener("offline", offBar);
  // The bar under the count shows only when something is off: no signal, check-ins waiting, or a clash to look at.
  function offBar() {
    var el = $("offbar"); if (!el || !OFF) return;
    var p = OFF.pending(), cl = OFF.clashes(), parts = [];
    if (offOn && navigator.onLine === false) parts.push("<b>No signal.</b> Checking tickets against this phone's list" + (OFF.listAt() ? " from " + new Date(OFF.listAt()).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "") + ".");
    if (p) parts.push(p + " check-in" + (p === 1 ? "" : "s") + " saved on this phone. " + (navigator.onLine === false ? "They send when signal is back." : "Sending..."));
    if (cl.length) parts.push("<b>" + cl.length + " flagged after sending:</b> " + cl.slice(-5).map(function (c) {
      return esc(c.name || "Someone") + (c.result === "used" ? " was already in" + (c.first_at ? " at " + new Date(c.first_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "")
        : c.result === "void" ? " had a void ticket" : c.result === "wrong_night" ? " had a ticket for another night" : " wasn't found");
    }).join(", ") + ' <button type="button" id="offok">OK</button>');
    el.innerHTML = parts.join("<br>"); el.hidden = !parts.length;
  }
  document.addEventListener("click", function (e) { if (e.target && e.target.id === "offok") { OFF.clearClashes(); offBar(); } });
  // Save the door page itself on the phone so it opens with no signal. Turned off with offline mode.
  function keepPage(on) {
    if (!("serviceWorker" in navigator)) return;
    if (!on) { navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { if (/door-sw\.js/.test((r.active || r.installing || r.waiting || {}).scriptURL || "")) r.unregister(); }); }).catch(function () {}); return; }
    navigator.serviceWorker.register("door-sw.js", { scope: "./door" }).then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
      // The page, everything it loaded (scripts, styles, fonts, images) and the QR reader iPhones use.
      var urls = [location.href, "assets/vendor/jsqr.min.js", "assets/toftu/eye-fri.webp", "assets/toftu/eye-sat.webp"];
      try { performance.getEntriesByType("resource").forEach(function (e) { if (e.name.indexOf(location.origin + "/") === 0) urls.push(e.name); }); } catch (e) {}
      if (reg.active) reg.active.postMessage({ cache: urls.map(function (u) { return new URL(u, location.href).href; }) });
    }).catch(function () {});
  }

  if (admin || door) boot(); else $("login").hidden = false;
})();
