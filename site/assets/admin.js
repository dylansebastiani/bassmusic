/* Staff page. Sign in with an emailed code; the session token lives on this device for 30 days.
   Shows: lineup, sales, guest list, codes, images, details. Ticket actions reuse the door
   function (it accepts the same staff token); everything else goes to the admin function. */
(function () {
  var S = window.Stack, C = S.C, $ = function (id) { return document.getElementById(id); }, esc = S.esc;
  var BASE = (C.supabaseUrl || "") + "/functions/v1/";
  var FN = BASE + "admin", DOOR = BASE + "door";
  var AKEY = "stack_admin", tok = null;
  try { tok = localStorage.getItem(AKEY); } catch (e) {}
  var TABS = ["shows", "tracks", "members", "numbers", "staff"], data = null, cur = null, curTab = "lineup", members = [];
  var usd = function (c) { return "$" + ((c || 0) / 100).toFixed(c % 100 ? 2 : 0); };
  var num = function (n) { return (n || 0).toLocaleString(); };

  function req(url, body, raw) {
    var o = { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" } };
    if (tok) o.headers["x-admin-token"] = tok;
    if (body) o.body = JSON.stringify(body);
    return fetch(url, o).then(function (r) {
      if (raw) return r;
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) signedOut();
        if (!r.ok) throw Object.assign(new Error(j.error || "Something went wrong. Try again."), { status: r.status });
        return j;
      });
    });
  }
  function call(a, body, raw) { return req(FN + "?a=" + a, body, raw); }
  // Show data is fetched once and reused for 30 seconds, so switching tabs is instant.
  // Any change (a POST) clears it, so the next tab shows fresh numbers.
  var pre = {};
  function cached(key, fn) {
    var hit = pre[key];
    if (hit && Date.now() - hit.t < 30000) return hit.p;
    var p = fn(); pre[key] = { t: Date.now(), p: p };
    p.catch(function () { delete pre[key]; });
    return p;
  }
  function door(a, body, params) {
    var qs = "?e=" + encodeURIComponent(cur.event.slug) + "&a=" + a + Object.keys(params || {}).map(function (k) { return "&" + k + "=" + encodeURIComponent(params[k]); }).join("");
    if (body) { pre = {}; return req(DOOR + qs, body); }
    return cached(qs, function () { return req(DOOR + qs); });
  }
  function say(id, t) { $(id).textContent = t || ""; }
  function signedOut() { tok = null; try { localStorage.removeItem(AKEY); } catch (e) {} $("app").hidden = true; $("login").hidden = false; $("signout").hidden = true; say("lmsg", "Signed out. Sign in again."); }
  function show(name) {
    TABS.forEach(function (n) { $("p-" + n).hidden = n !== name; });
    [].forEach.call(document.querySelectorAll("#tabs [data-tab]"), function (b) { b.setAttribute("aria-selected", b.getAttribute("data-tab") === name ? "true" : "false"); });
    try { history.replaceState(null, "", "#" + name); } catch (e) {}
    scrollTo(0, 0);
  }
  $("tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) { if (b.getAttribute("data-tab") === "shows") closeShow(); show(b.getAttribute("data-tab")); } });
  $("signout").addEventListener("click", function () { try { localStorage.removeItem(AKEY); } catch (e) {} location.reload(); });

  // ---------- sign in ----------
  var email = "";
  $("lf").addEventListener("submit", function (e) {
    e.preventDefault(); email = $("aemail").value.trim(); say("lmsg", "Sending...");
    call("login", { email: email }).then(function (r) { $("cf").hidden = false; say("lmsg", r.note || "Code sent. Check your email (and spam)."); $("acode").focus(); })
      .catch(function (err) { say("lmsg", err.message); });
  });
  $("cf").addEventListener("submit", function (e) {
    e.preventDefault(); say("lmsg", "Checking...");
    call("verify", { email: email, code: $("acode").value }).then(function (r) { tok = r.token; try { localStorage.setItem(AKEY, tok); localStorage.setItem("stack_admin_email", r.email || email); } catch (x) {} boot(); })
      .catch(function (err) { say("lmsg", err.message); });
  });

  // ================= SHOWS: the list =================
  function fmt(s) { return s ? S.fmtDate(s, true) : ""; }
  function paintShows(d) {
    var evs = d.events.slice().sort(function (a, b) { return new Date(b.starts_at || 0) - new Date(a.starts_at || 0); });
    $("shows").innerHTML = evs.length ? evs.map(function (e) {
      var up = e.starts_at && new Date(e.ends_at || e.starts_at) > new Date();
      // Only past shows are dimmed. "Switched off" just keeps a show off the members' page and
      // stickers (a secret-location show stays off so its venue isn't shown); tickets still sell.
      return '<button type="button" class="card showcard' + (up ? "" : " off") + '" data-open="' + esc(e.slug) + '">' +
        '<span class="chips"><span class="chip' + (up ? "" : " alt") + '">' + (up ? "Upcoming" : "Past") + "</span>" + (e.is_active || !up ? "" : '<span class="chip alt">Not on member page</span>') + "</span>" +
        "<h3>" + esc(e.name) + "</h3>" + (e.starts_at ? '<div class="when">' + esc(fmt(e.starts_at)) + "</div>" : "") +
        (e.city ? '<div class="where mono">' + esc(e.city) + "</div>" : "") + '<span class="go mono">Open →</span></button>';
    }).join("") : '<div class="empty">No shows yet. Add one below.</div>';
  }
  $("shows").addEventListener("click", function (e) { var b = e.target.closest("[data-open]"); if (b) openShow(b.getAttribute("data-open")); });

  // ================= SHOWS: one show =================
  var SEGS = [["lineup", "Lineup"], ["sales", "Sales"], ["guests", "Door List"], ["artists", "Artists"], ["playlist", "Playlist"], ["codes", "Codes"], ["images", "Images"], ["details", "Details"]];
  function openShow(slug, keepTab) {
    $("showList").hidden = true; $("showView").hidden = false; scrollTo(0, 0);
    $("svName").textContent = "Loading..."; $("svWhen").textContent = ""; $("svLinks").innerHTML = ""; $("seg").innerHTML = "";
    SEGS.forEach(function (s) { $("sv-" + s[0]).hidden = true; });
    return call("show&e=" + encodeURIComponent(slug)).then(function (d) {
      cur = d; cur.base = (data.events || []).filter(function (x) { return x.slug === slug; })[0] || {};
      $("svName").textContent = d.event.name;
      $("svWhen").textContent = [fmt(d.event.starts_at), d.event.city].filter(Boolean).join(" · ");
      $("svLinks").innerHTML = d.ticketed ? '<a class="pill" href="' + esc(d.event.page_url) + '" target="_blank" rel="noopener">Ticket page ↗</a>' +
        '<a class="pill" href="door.html?e=' + esc(slug) + '" target="_blank" rel="noopener">Door app ↗</a>' +
        '<span class="pill ' + (d.event.sales_open ? "on" : "") + '">Sales ' + (d.event.sales_open ? "on" : "off") + "</span>" +
        '<span class="pill ' + (d.lineup_public ? "on" : "") + '">Lineup ' + (d.lineup_public ? "public" : "hidden") + "</span>" : "";
      var segs = d.ticketed ? SEGS : [["details", "Details"], ["playlist", "Playlist"]];
      $("seg").innerHTML = segs.map(function (s) { return '<button type="button" data-seg="' + s[0] + '">' + s[1] + "</button>"; }).join("");
      seg(keepTab && segs.some(function (s) { return s[0] === curTab; }) ? curTab : segs[0][0]);
      // Load the other tabs in the background so they open instantly.
      if (d.ticketed) { door("sales").catch(function () {}); door("guests").catch(function () {}); artGet().catch(function () {}); }
    }).catch(function (err) { $("svName").textContent = err.message; });
  }
  function closeShow() { cur = null; $("showView").hidden = true; $("showList").hidden = false; }
  $("back").addEventListener("click", function () { closeShow(); scrollTo(0, 0); });
  $("seg").addEventListener("click", function (e) { var b = e.target.closest("[data-seg]"); if (b) seg(b.getAttribute("data-seg")); });
  function seg(name) {
    curTab = name;
    SEGS.forEach(function (s) { $("sv-" + s[0]).hidden = s[0] !== name; });
    [].forEach.call($("seg").children, function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-seg") === name ? "true" : "false"); });
    ({ lineup: drawLineup, sales: sales, guests: guests, artists: artists, playlist: playlist, codes: codes, images: drawImages, details: drawDetails })[name]();
  }
  function refreshShow() { return openShow(cur.event.slug, true); }

  // ---------- lineup + set times ----------
  var NIGHTC = ["fri", "sat"];
  function actRow(a) {
    return '<div class="act"><input type="text" class="an" value="' + esc(a.name || "") + '" placeholder="Artist" maxlength="80" aria-label="Artist">' +
      '<input type="text" class="at" value="' + esc(a.note || "") + '" placeholder="Set time" maxlength="40" aria-label="Set time">' +
      '<label class="asec" title="Secret: kept off the public page; one \'Headliner TBA\' line shows instead"><input type="checkbox" class="as"' + (a.secret ? " checked" : "") + '> Secret</label>' +
      '<span class="ab"><button type="button" data-mv="-1" aria-label="Move up">▲</button><button type="button" data-mv="1" aria-label="Move down">▼</button><button type="button" data-rm aria-label="Remove">✕</button></span></div>';
  }
  function drawLineup() {
    var pub = cur.lineup_public;
    $("luState").className = "banner " + (pub ? "on" : "");
    $("luState").innerHTML = pub
      ? "<div><b>Lineup is public.</b> The ticket page and flyers show it. Saving changes here updates the page right away.</div><button type=\"button\" class=\"btn ghost\" id=\"luToggle\">Hide lineup</button>"
      : "<div><b>Lineup is hidden.</b> The ticket page says \"Lineup coming soon\". Edit it here, then reveal it when you're ready.</div><button type=\"button\" class=\"btn\" id=\"luToggle\">Reveal lineup</button>";
    var secretAny = cur.nights.some(function (n) { return n.acts.some(function (a) { return a.secret; }); });
    $("luOpts").innerHTML = '<label class="luopt"><input type="checkbox" id="luHideTimes"' + (cur.hide_set_times ? " checked" : "") + '> Hide set times on the public page</label>' +
      '<p class="mono luhint">Tick <b>Secret</b> on an act to keep it off the public page. One "Headliner TBA" line shows in its place, and the flyers stay hidden until nothing is secret.' + (secretAny ? " " + "Secret now: " + cur.nights.map(function (n) { return n.acts.filter(function (a) { return a.secret; }).map(function (a) { return esc(a.name); }).join(", "); }).filter(Boolean).join(" · ") + "." : "") + "</p>";
    $("luNights").innerHTML = cur.nights.map(function (n, i) {
      return '<div class="night ' + NIGHTC[i % 2] + '" data-night="' + esc(n.id) + '"><div class="nh"><span class="disp">' + esc(n.label) + '</span><span class="mono">Top of the bill first</span></div>' +
        '<div class="acts">' + (n.acts.length ? n.acts.map(actRow).join("") : "") + "</div>" +
        '<button type="button" class="add1" data-add>+ Add artist</button></div>';
    }).join("") || '<div class="empty">This show has no nights set up.</div>';
    say("luMsg", "");
  }
  $("luNights").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var night = b.closest(".night"), row = b.closest(".act");
    if (b.hasAttribute("data-add")) { var box = night.querySelector(".acts"); box.insertAdjacentHTML("beforeend", actRow({})); box.lastChild.querySelector(".an").focus(); }
    else if (b.hasAttribute("data-rm")) row.remove();
    else if (b.getAttribute("data-mv") === "-1" && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
    else if (b.getAttribute("data-mv") === "1" && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
    say("luMsg", "Unsaved changes");
  });
  $("luNights").addEventListener("input", function () { say("luMsg", "Unsaved changes"); });
  $("luOpts").addEventListener("change", function () { say("luMsg", "Unsaved changes"); });
  function collectLineup() {
    return [].map.call($("luNights").querySelectorAll(".night"), function (n) {
      return { id: n.getAttribute("data-night"), acts: [].map.call(n.querySelectorAll(".act"), function (r) { return { name: r.querySelector(".an").value.trim(), note: r.querySelector(".at").value.trim(), secret: r.querySelector(".as").checked }; }).filter(function (a) { return a.name; }) };
    });
  }
  function saveLineup() {
    say("luMsg", "Saving..."); $("luSave").disabled = true;
    return call("lineup-save", { e: cur.event.slug, nights: collectLineup(), hide_set_times: $("luHideTimes").checked }).then(function () {
      cur.hide_set_times = $("luHideTimes").checked;
      $("luSave").disabled = false; say("luMsg", cur.lineup_public ? "Saved. The ticket page is updated." : "Saved. Still hidden from the public.");
      cur.nights.forEach(function (n) { var c = collectLineup().filter(function (x) { return x.id === n.id; })[0]; if (c) n.acts = c.acts; });
    }).catch(function (err) { $("luSave").disabled = false; say("luMsg", err.message); throw err; });
  }
  $("luSave").addEventListener("click", function () { saveLineup().catch(function () {}); });
  $("luState").addEventListener("click", function (e) {
    if (!e.target.closest("#luToggle")) return;
    var pub = !cur.lineup_public;
    var sec = collectLineup().some(function (n) { return n.acts.some(function (a) { return a.secret; }); }), hide = $("luHideTimes").checked;
    if (!confirm(pub ? "Reveal the lineup? The ticket page shows it right away." + (sec ? " Secret acts stay hidden (one \"Headliner TBA\" line instead) and the flyers stay off." : " The flyers show too.") + (hide ? " Set times stay hidden." : "") : "Hide the lineup? The ticket page goes back to \"Lineup coming soon\".")) return;
    saveLineup().then(function () { return call("lineup-publish", { e: cur.event.slug, public: pub }); })
      .then(function () { return refreshShow(); }).then(function () { say("luMsg", pub ? "Lineup is live." : "Lineup hidden."); }).catch(function (err) { say("luMsg", err.message); });
  });

  // ---------- sales ----------
  var lastSales = null;
  function sales() {
    $("sstats").innerHTML = '<div class="stat"><b>…</b><span>Loading</span></div>';
    return door("sales").then(function (d) {
      lastSales = d;
      var sold = d.by_type.reduce(function (s, t) { return s + t.sold; }, 0), comps = d.by_type.reduce(function (s, t) { return s + t.comps; }, 0);
      $("sstats").innerHTML = [["Gross", usd(d.gross_cents)], ["Tickets sold", sold], ["Guest list", comps], ["Orders", d.orders]]
        .map(function (x) { return '<div class="stat"><b>' + x[1] + "</b><span>" + x[0] + "</span></div>"; }).join("");
      $("stypes").innerHTML = d.by_type.filter(function (t) { return t.tiers.length && (!/test/i.test(t.name) || t.sold); }).map(function (t) {
        var tot = t.tiers.reduce(function (s, r) { return s + r.qty; }, 0), pct = tot ? Math.min(100, Math.round(100 * t.sold / tot)) : 0;
        return '<div class="ttype"><div class="tt"><b>' + esc(t.name) + '</b><span class="mono">' + t.sold + " / " + tot + " sold" + (t.comps ? " · " + t.comps + " guest list" : "") +
          (t.now && t.now.tier ? " · now " + esc(t.now.tier.name) + " " + usd(t.now.tier.price_cents) + " (" + t.now.tier.left + " left)" : t.now && t.now.sold_out ? " · SOLD OUT" : "") + "</span></div>" +
          '<div class="meter"><i style="width:' + pct + '%"></i></div>' +
          '<div class="tiers">' + t.tiers.map(function (r) { return '<span class="' + (r.sold >= r.qty ? "done" : "") + '">' + esc(r.name) + " · " + usd(r.price_cents) + " · " + r.sold + "/" + r.qty + "</span>"; }).join("") + "</div></div>";
      }).join("");
      $("salesState").innerHTML = d.sales_open ? "<b>Ticket sales are ON</b>" : "<b>Ticket sales are OFF</b>";
      $("salesBtn").textContent = d.sales_open ? "Turn off" : "Turn on";
      $("salesBtn").setAttribute("data-open", d.sales_open ? "1" : "0");
      $("otable").querySelector("tbody").innerHTML = d.recent.length ? d.recent.map(function (o) {
        return "<tr><td>" + esc(o.name) + '</td><td class="num">' + o.qty + '</td><td class="num">' + usd(o.total_cents) + "</td><td>" + esc(o.promo || "") + "</td><td>" + new Date(o.paid_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + "</td></tr>";
      }).join("") : '<tr><td colspan="5">No orders yet.</td></tr>';
      return d;
    }).catch(function (err) { $("sstats").innerHTML = '<div class="empty">' + esc(err.message) + "</div>"; });
  }
  $("salesBtn").addEventListener("click", function () {
    var open = $("salesBtn").getAttribute("data-open") !== "1";
    if (!confirm(open ? "Turn ticket sales ON? The page starts selling right away." : "Turn ticket sales OFF? Nobody can buy until you turn it back on.")) return;
    door("settings", { sales_open: open }).then(sales).catch(function (err) { alert(err.message); });
  });

  // ---------- guest list ----------
  function guests() {
    // Guest list: the 2-Day Pass first (the default), then each single night. Never the hidden test ticket.
    var gt = cur.types.filter(function (t) { return t.slug !== "test" && t.slug !== "artist"; }).sort(function (a, b) { return (b.night_ids || []).length - (a.night_ids || []).length; });
    if (!$("gtype").options.length || $("gtype").getAttribute("data-show") !== cur.event.slug) {
      $("gtype").innerHTML = gt.map(function (t) { return '<option value="' + esc(t.slug) + '">' + esc(t.name) + ((t.night_ids || []).length > 1 ? " (both nights)" : " only") + "</option>"; }).join("");
      $("gtype").setAttribute("data-show", cur.event.slug);
    }
    $("guests").innerHTML = '<div class="empty">Loading...</div>';
    door("guests").then(function (d) { GL = d.guests; drawList(); })
      .catch(function (err) { $("guests").innerHTML = '<div class="empty">' + esc(err.message) + "</div>"; });
  }
  // The door list: everyone with a ticket. Filter by group, search, see who's checked in each night.
  var GL = [], GF = "all";
  var KINDS = [["all", "Everyone"], ["paid", "Bought"], ["guest", "Guest list"], ["artist", "Artists"], ["artist_guest", "Artist guests"]];
  var KLABEL = { paid: "Bought", guest: "Guest list", artist: "Artist", artist_guest: "Artist guest" };
  function drawList() {
    var n = function (k) { return k === "all" ? GL.length : GL.filter(function (g) { return g.kind === k; }).length; };
    $("gtotal").textContent = GL.length;
    $("gfilter").innerHTML = KINDS.filter(function (k) { return k[0] === "all" || n(k[0]); }).map(function (k) {
      return '<button type="button" data-k="' + k[0] + '" aria-pressed="' + (GF === k[0]) + '">' + k[1] + " <i>" + n(k[0]) + "</i></button>";
    }).join("");
    var q = $("gsearch").value.trim().toLowerCase();
    var rows = GL.filter(function (g) { return (GF === "all" || g.kind === GF) && (!q || [g.name, g.real_name, g.email, g.code, g.list].join(" ").toLowerCase().indexOf(q) >= 0); });
    var inside = rows.filter(function (g) { return g.nights.some(function (x) { return x.in; }); }).length;
    say("gcount", rows.length ? rows.length + " shown" + (inside ? " · " + inside + " checked in" : "") : "");
    $("guests").innerHTML = rows.length ? rows.map(function (g) {
      var badges = g.nights.map(function (x) { return '<em class="nt' + (x.in ? " in" : "") + '">' + esc(x.label.split(" ")[0]) + (x.in ? " ✓" : "") + "</em>"; }).join("");
      return '<div class="person k-' + g.kind + '"><div><b>' + esc(g.name || "No name") + ' <small class="kind">' + KLABEL[g.kind] + "</small></b>" +
        (g.real_name ? '<span class="mono">ID name: ' + esc(g.real_name) + "</span>" : "") +
        '<span class="mono">' + esc(g.type || "") + (g.list && g.kind !== "artist" ? " · " + esc(g.list) + "'s list" : "") + " · " + esc(g.code) + (g.email ? " · " + esc(g.email) : "") + (g.phone ? " · " + esc(g.phone) : "") + "</span>" +
        '<span class="nts">' + badges + "</span></div>" +
        '<span class="pa">' + (g.email ? '<button type="button" data-resend="' + esc(g.ticket_id) + '">Resend</button>' : "") +
        (g.comp && g.kind !== "artist" ? '<button type="button" data-void="' + esc(g.ticket_id) + '">Remove</button>' : "") + "</span></div>";
    }).join("") : '<div class="empty">' + (GL.length ? "No one matches." : "No one yet.") + "</div>";
  }
  $("gfilter").addEventListener("click", function (e) { var b = e.target.closest("[data-k]"); if (b) { GF = b.getAttribute("data-k"); drawList(); } });
  $("gsearch").addEventListener("input", drawList);
  $("gadd").addEventListener("click", function () { var f = $("gf"); f.hidden = !f.hidden; $("gadd").textContent = f.hidden ? "+ Add to guest list" : "Close"; if (!f.hidden) $("gname").focus(); });
  // Same checks as checkout: full name, a real email (with a nudge for common typos), a reachable phone.
  var FIX = { "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com", "hotmial.com": "hotmail.com", "iclod.com": "icloud.com", "icloud.con": "icloud.com", "outlok.com": "outlook.com" };
  function checkEmail() {
    var v = $("gemail").value.trim().toLowerCase(), h = $("gemailh"), dom = v.split("@")[1] || "";
    if (!v) { h.textContent = ""; return false; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) { h.textContent = "That email doesn't look complete."; h.className = "hint bad"; return false; }
    if (FIX[dom]) { h.innerHTML = 'Did you mean <button type="button" class="mini" id="gfix">' + esc(v.split("@")[0] + "@" + FIX[dom]) + "</button>?"; h.className = "hint"; return true; }
    h.textContent = ""; return true;
  }
  function checkPhone() {
    var d = $("gphone").value.replace(/\D/g, ""), h = $("gphoneh");
    if (d.length === 10) $("gphone").value = "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
    var ok = d.length === 10 || (d.length === 11 && d[0] === "1") || (d.length >= 11 && d.length <= 15);
    h.textContent = d && !ok ? "Enter a 10-digit phone number." : ""; h.className = "hint bad"; return ok;
  }
  $("gemail").addEventListener("blur", checkEmail); $("gphone").addEventListener("blur", checkPhone);
  $("gemailh").addEventListener("click", function (e) { var b = e.target.closest("#gfix"); if (b) { $("gemail").value = b.textContent; checkEmail(); } });
  $("gf").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("gname").value.trim().replace(/\s+/g, " ");
    if (name.split(" ").length < 2) return say("gmsg", "Enter their full name (first and last).");
    if (!checkEmail()) return say("gmsg", "Enter the email their ticket should go to.");
    if (!checkPhone()) return say("gmsg", "Enter a phone number we can reach them at.");
    say("gmsg", "Sending..."); $("ggo").disabled = true;
    door("comp", { strict: true, type: $("gtype").value, list: $("glist").value.trim() || null, people: [{ name: name, email: $("gemail").value.trim().toLowerCase(), phone: $("gphone").value }] }).then(function (r) {
      $("ggo").disabled = false;
      say("gmsg", r.emailed ? "Sent. " + name + " has a " + $("gtype").options[$("gtype").selectedIndex].text.replace(" only", "").replace(" (both nights)", "") + " ticket in their email (tell them to check spam)." : "Added, but the email didn't go out. Use Resend below.");
      $("gname").value = ""; $("gemail").value = ""; $("gphone").value = ""; guests();
    }).catch(function (err) { $("ggo").disabled = false; say("gmsg", err.message); });
  });
  $("guests").addEventListener("click", function (e) {
    var v = e.target.closest("[data-void]"), r = e.target.closest("[data-resend]");
    if (v) { if (!confirm("Take this person off the list? Their ticket stops working.")) return; door("void", { ticket_id: v.getAttribute("data-void") }).then(guests).catch(function (err) { say("gmsg", err.message); }); }
    if (r) { r.disabled = true; door("resend", { ticket_id: r.getAttribute("data-resend") }).then(function (x) { r.textContent = x.sent ? "Sent ✓" : "Failed"; }).catch(function (err) { r.disabled = false; say("gmsg", err.message); }); }
  });

  // ---------- artists ----------
  var ART = BASE + "artist";
  function artGet() { var u = ART + "?a=list&e=" + encodeURIComponent(cur.event.slug); return cached(u, function () { return req(u); }); }
  // What the artist filled in: public profile (on the lineup) and their private notes for you.
  function aprofile(a) {
    var p = a.profile || {}, links = Object.keys(p.links || {});
    var has = p.photo_url || p.bio || p.hometown || p.genre || links.length;
    if (!has && !p.rider) return "";
    return '<div class="aprof">' + (p.photo_url ? '<img src="' + esc(p.photo_url) + '" alt="">' : "") + "<div>" +
      (has ? '<div class="mono asub">' + (p.hidden ? "Profile hidden from the lineup" : "Profile live on the lineup") + ([p.hometown, p.genre].filter(Boolean).length ? " · " + [p.hometown, p.genre].filter(Boolean).map(esc).join(" · ") : "") + "</div>" : "") +
      (p.bio ? '<p class="abio">' + esc(p.bio) + "</p>" : "") +
      (links.length ? '<div class="alinks">' + links.map(function (k) { return '<a href="' + esc(p.links[k]) + '" target="_blank" rel="noopener nofollow">' + esc(k) + " ↗</a>"; }).join("") + "</div>" : "") +
      (p.rider ? '<div class="arider"><b>Their notes for you</b>' + esc(p.rider) + "</div>" : "") +
      (has && !a.revoked ? '<button type="button" class="mini" data-hide="' + esc(a.id) + '" data-h="' + (p.hidden ? "" : "1") + '">' + (p.hidden ? "Show on lineup" : "Hide from lineup") + "</button>" : "") +
      "</div></div>";
  }
  // Fans who downloaded artists' tracks at this show, grouped by artist for the cards below.
  var DLS = {};
  function dlCsv(rows, name) {
    var cols = ["name", "email", "phone", "zip", "track_title", "created_at"], head = ["Name", "Email", "Phone", "ZIP", "Track", "Downloaded"];
    var q = function (v) { v = v == null ? "" : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var blob = new Blob([[head.join(",")].concat(rows.map(function (x) { return cols.map(function (c) { return q(x[c]); }).join(","); })).join("\n")], { type: "text/csv" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = String(name).replace(/[^\w -]+/g, "") + " - fans.csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  document.addEventListener("submit", function (e) {
    var f = e.target.closest && e.target.closest("[data-ms]"); if (!f) return;
    e.preventDefault();
    var n = parseInt(f.querySelector("input").value, 10) || 0, b = f.querySelector("button");
    b.disabled = true;
    req(BASE + "artist-sales?a=milestone", { e: cur.event.slug, n: n }).then(function () { artists(); }).catch(function (err) { b.disabled = false; alert(err.message); });
  });
  function artists() {
    $("artists").innerHTML = '<div class="empty">Loading...</div>';
    var dl = req(BASE + "playlist?a=downloads&e=" + encodeURIComponent(cur.event.slug)).then(function (d) {
      DLS = {}; (d.downloads || []).forEach(function (x) { (DLS[x.invite_id] = DLS[x.invite_id] || []).push(x); });
    }).catch(function () { DLS = {}; });
    // Who's selling: tickets credited to each artist's personal link or code (read-only, from paid orders).
    var SOLD = {}, SOLDSUM = null;
    var sold = req(BASE + "artist-sales?a=staff&e=" + encodeURIComponent(cur.event.slug)).then(function (d) {
      (d.artists || []).forEach(function (x) { SOLD[x.id] = x; }); SOLDSUM = d;
    }).catch(function () {});
    Promise.all([artGet(), dl, sold]).then(function (x) { return x[0]; }).then(function (d) {
      if (SOLDSUM && d.artists.length) d.artists.sort(function (p, q) { return ((SOLD[q.id] || {}).tickets || 0) - ((SOLD[p.id] || {}).tickets || 0); });
      $("artists").innerHTML = (SOLDSUM && d.artists.length ? '<div class="mono asub sellsum">Artists sold <b>' + num(SOLDSUM.credited_tickets) + "</b> of " + num(SOLDSUM.all_tickets) + " paid tickets so far</div>" +
        (SOLDSUM.can_set_milestone ? '<form class="msform" data-ms><label for="msn">Star artists at</label><input id="msn" type="number" min="1" max="9999" inputmode="numeric" value="' + (SOLDSUM.milestone || "") + '" placeholder="e.g. 10"><span>tickets</span><button type="submit" class="mini">Save</button><small>Only you see this. Artists never do.</small></form>' : "") : "") +
        (d.artists.length ? d.artists.map(function (a) {
        var status = a.revoked ? '<span class="chip alt">cancelled</span>' : a.claimed ? '<span class="chip gold">pass sent</span>' : '<span class="chip alt">link not used yet</span>';
        return '<div class="acard2' + (a.revoked ? " off" : "") + '"><div class="ah"><b>' + esc(a.name) + "</b>" + status + "</div>" +
          (a.full_name || a.email || a.phone ? '<div class="mono asub">' + [a.full_name, a.email, a.phone].filter(Boolean).map(esc).join(" · ") + "</div>" : "") +
          ((a.members || []).map(function (m) {
            return '<div class="mono asub">+ ' + esc(m.full_name) + " · " + esc(m.email) + ' <button type="button" class="mini" data-copy="' + esc(m.link) + '">Copy their link</button>' +
              (a.revoked ? "" : ' <button type="button" class="mini danger" data-mrm="' + esc(m.id) + '" data-act="' + esc(a.id) + '" data-name="' + esc(m.full_name) + '">Remove</button>') + "</div>";
          }).join("")) +
          '<div class="mono asub">' + a.guests.length + " of " + a.spots + " guest spots used" + ((a.members || []).length ? " (shared)" : "") + "</div>" +
          (a.guests.length ? '<div class="aguests">' + a.guests.map(function (g) { return "<span>" + esc(g.name) + "</span>"; }).join("") + "</div>" : "") +
          aprofile(a) +
          (SOLD[a.id] ? '<div class="asell">' + (SOLD[a.id].milestone_hit ? '<span class="star" title="Hit your milestone">★ Milestone</span> ' : "") +
            "<b>" + num(SOLD[a.id].tickets) + (SOLD[a.id].tickets === 1 ? " ticket" : " tickets") + " sold</b>" +
            (SOLD[a.id].tickets ? " · " + usd(SOLD[a.id].revenue_cents) + " · " + SOLD[a.id].by_link + " by link, " + SOLD[a.id].by_code + " by code" : "") +
            '<div class="mono asub">' + num(SOLD[a.id].clicks) + " link taps (" + num(SOLD[a.id].people) + " people)" +
            (SOLD[a.id].people ? " · " + Math.round(100 * SOLD[a.id].orders / SOLD[a.id].people) + "% bought" : "") + "</div>" +
            '<div class="mono asub">' + esc(SOLD[a.id].link.replace(/^https?:\/\//, "")) + " · code " + esc(SOLD[a.id].code) + ' · <button type="button" class="mini" data-copy="' + esc(SOLD[a.id].link) + '">Copy sell link</button></div></div>' : "") +
          (DLS[a.id] && DLS[a.id].length ? '<div class="mono asub">' + DLS[a.id].length + " track download" + (DLS[a.id].length === 1 ? "" : "s") + ' · <button type="button" class="mini" data-fans="' + esc(a.id) + '" data-name="' + esc(a.name) + '">Download fan list</button></div>' : "") +
          (a.revoked ? "" : '<div class="atools"><button type="button" class="mini" data-copy="' + esc(a.link) + '">Copy pass link</button>' +
            '<a class="mini" href="' + esc(a.link) + '" target="_blank" rel="noopener">Open their page ↗</a>' +
            '<span class="spin"><button type="button" class="mini" data-spots="' + esc(a.id) + '" data-n="' + Math.max(0, a.spots - 1) + '" aria-label="Fewer spots">−</button><span>' + a.spots + ' spots</span><button type="button" class="mini" data-spots="' + esc(a.id) + '" data-n="' + (a.spots + 1) + '" aria-label="More spots">+</button></span>' +
            '<button type="button" class="mini" data-madd="' + esc(a.id) + '" data-name="' + esc(a.name) + '">Add a member</button>' +
            '<button type="button" class="mini danger" data-revoke="' + esc(a.id) + '" data-name="' + esc(a.name) + '">Cancel artist</button></div>') + "</div>";
      }).join("") : '<div class="empty">No artists yet. Create one above.</div>');
    }).catch(function (err) { $("artists").innerHTML = '<div class="empty">' + esc(err.message) + "</div>"; });
  }
  // ---------- playlist: the music bar on this show's page ----------
  var PLF = BASE + "playlist", pl = null;
  function plKeep() { (pl && pl.tracks || []).forEach(function (t, i) { var a = $("plt" + i), b = $("pla" + i); if (a) t.title = a.value.trim(); if (b) t.artist = b.value.trim(); }); }
  function plDraw() {
    var own = pl.mode === "upload", full = pl.tracks.length >= (pl.max || 20);
    $("plMode").innerHTML = '<button type="button" class="mini" data-plmode="subduction" aria-pressed="' + !own + '">Subduction tracks</button><button type="button" class="mini" data-plmode="upload" aria-pressed="' + own + '">Our own tracks</button>';
    $("plOwn").innerHTML = own ? (pl.tracks.length ? pl.tracks.map(function (t, i) {
        return '<div class="plrow"><input type="text" id="plt' + i + '" maxlength="80" value="' + esc(t.title) + '" aria-label="Track title" placeholder="Title"><input type="text" id="pla' + i + '" maxlength="80" value="' + esc(t.artist || "") + '" aria-label="Artist" placeholder="Artist"><button type="button" class="mini danger" data-plrm="' + i + '">Remove</button></div>';
      }).join("") : '<div class="empty">No tracks yet. Add one below.</div>') +
      (full ? '<p class="fine">That\'s the most a show can have (' + (pl.max || 20) + ').</p>' : '<label class="pladd"><b>+ Add a track</b><span class="mono" id="plSt">MP3, WAV or M4A, up to 50 MB</span><span class="plbar"><i id="plBar"></i></span><input type="file" id="plFile" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4"></label>')
      : '<p class="fine">The page plays a random mix of Subduction tracks, plus anything the artists add. Nothing to upload.</p>';
    var at = pl.artist_tracks || [];
    $("plArt").innerHTML = at.length ? at.map(function (t) {
      var id = esc(t.id);
      return '<div class="plcard" data-plid="' + id + '">' +
        '<label class="plcov" title="Change cover">' + (t.art_url ? '<img src="' + esc(t.art_url) + '" alt="">' : "<span>+ Cover</span>") + '<input type="file" accept="image/jpeg,image/png,image/webp" data-plcov="' + id + '"></label>' +
        '<div class="plfields"><input type="text" maxlength="80" value="' + esc(t.title) + '" data-pltitle aria-label="Track name" placeholder="Track name">' +
        '<input type="text" maxlength="80" value="' + esc(t.artist || "") + '" data-plartist aria-label="Artist" placeholder="Artist">' +
        '<label class="plchk"><input type="checkbox" data-plfree' + (t.free_download ? " checked" : "") + '> Free download</label>' +
        '<div class="plbtns"><button type="button" class="mini" data-plsave="' + id + '">Save</button>' +
        '<label class="mini plrep">Replace file<input type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" data-plfile="' + id + '"></label>' +
        '<button type="button" class="mini danger" data-plarm="' + id + '">Remove</button></div>' +
        '<span class="mono plst" data-plst="' + id + '">' + esc((t.ext || "").toUpperCase()) + '</span><span class="plbar"><i data-plbar="' + id + '"></i></span></div></div>';
    }).join("") : '<div class="empty">Artists add their own tracks from their artist link. They show up here.</div>';
    var f = $("plFile"); if (f) f.onchange = plUpload;
  }
  function plFans() {
    $("plFans").innerHTML = '<div class="empty">Loading...</div>';
    req(PLF + "?a=downloads&e=" + encodeURIComponent(cur.event.slug)).then(function (d) {
      var rows = d.downloads || [];
      $("plFans").innerHTML = rows.length ? '<div class="plfan"><b>' + rows.length + " download" + (rows.length === 1 ? "" : "s") + '</b> <button type="button" class="mini" id="plCsv">Download fan list (CSV)</button></div>' +
        rows.slice(0, 8).map(function (x) { return '<div class="mono asub">' + esc(x.name) + " · " + esc(x.track_title || "") + " · " + esc(x.zip || "") + "</div>"; }).join("") +
        (rows.length > 8 ? '<div class="mono asub">+ ' + (rows.length - 8) + " more in the CSV</div>" : "")
        : '<div class="empty">No downloads yet. When an artist turns on free download, fans give their name, email, phone and ZIP to get the track.</div>';
      var b = $("plCsv"); if (b) b.onclick = function () { dlCsv(rows, cur.event.name); };
    }).catch(function (err) { $("plFans").innerHTML = '<div class="empty">' + esc(err.message) + "</div>"; });
  }
  function playlist() {
    var id = cur.base && cur.base.id; say("plMsg", "");
    $("plMode").innerHTML = ""; $("plArt").innerHTML = ""; $("plOwn").innerHTML = '<div class="empty">Loading...</div>';
    if (!id) { $("plOwn").innerHTML = '<div class="empty">Couldn\'t find this show. Go back and open it again.</div>'; return; }
    req(PLF + "?a=get&show=" + id).then(function (r) { pl = r; pl.id = id; plDraw(); }).catch(function (err) { $("plOwn").innerHTML = '<div class="empty">' + esc(err.message) + "</div>"; });
    plFans();
  }
  function plPut(r, f, bar) {
    return new Promise(function (ok, no) {
      var x = new XMLHttpRequest(); x.open("PUT", r.upload_url, true); x.setRequestHeader("Content-Type", r.content_type);
      x.upload.onprogress = function (e) { if (bar && e.lengthComputable) bar.style.width = Math.round(e.loaded / e.total * 100) + "%"; };
      x.onload = function () { x.status < 300 ? ok(r.path) : no(new Error("Upload failed. Try again.")); };
      x.onerror = function () { no(new Error("Upload failed. Check your connection.")); };
      x.send(f);
    });
  }
  function plQ(id, attr) { return document.querySelector("[" + attr + '="' + id + '"]'); }
  // Change an artist track's cover or audio file from admin.
  $("sv-playlist").addEventListener("change", function (e) {
    var cov = e.target.getAttribute("data-plcov"), fil = e.target.getAttribute("data-plfile"), id = cov || fil;
    if (!id || !pl) return;
    var f = e.target.files[0]; if (!f) return;
    var st = plQ(id, "data-plst"), bar = plQ(id, "data-plbar"), ext = (f.name.split(".").pop() || "").toLowerCase();
    if (cov) {
      if (["jpg", "jpeg", "png", "webp"].indexOf(ext) < 0) { st.textContent = "Use a JPG, PNG or WebP."; return; }
      if (f.size > 5 * 1048576) { st.textContent = "Cover is over 5 MB. Use a smaller image."; return; }
    } else {
      if (["mp3", "wav", "m4a"].indexOf(ext) < 0) { st.textContent = "Use an MP3, WAV or M4A."; return; }
      if (f.size > 50 * 1048576) { st.textContent = "Over 50 MB. Export it as a 320 kbps MP3 and it will fit."; return; }
    }
    st.textContent = "Uploading...";
    req(PLF, cov ? { a: "upload-url", show: pl.id, ext: ext, kind: "art" } : { a: "upload-url", show: pl.id, ext: ext })
      .then(function (r) { return plPut(r, f, bar); })
      .then(function (path) { return req(PLF, cov ? { a: "track-art", show: pl.id, id: id, art_path: path } : { a: "track-file", show: pl.id, id: id, path: path }); })
      .then(function (r) { pl.artist_tracks = r.artist_tracks; plDraw(); say("plMsg", cov ? "New cover saved." : "File replaced. The show page picks it up within about 5 minutes."); })
      .catch(function (x) { st.textContent = x.message; });
  });
  function plUpload() {
    var inp = $("plFile"), f = inp.files[0]; if (!f) return;
    var st = $("plSt"), bar = $("plBar"), ext = (f.name.split(".").pop() || "").toLowerCase();
    if (["mp3", "wav", "m4a"].indexOf(ext) < 0) { st.textContent = "Use an MP3, WAV or M4A."; return; }
    if (f.size > 50 * 1048576) { st.textContent = "Over 50 MB. Export it as a 320 kbps MP3 and it will fit."; return; }
    plKeep(); st.textContent = "Uploading...";
    req(PLF, { a: "upload-url", show: pl.id, ext: ext }).then(function (r) { return plPut(r, f, bar);
    }).then(function (path) {
      pl.tracks.push({ path: path, title: f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80), artist: "" });
      plDraw(); say("plMsg", "Added. Check the title, then Save playlist.");
    }).catch(function (e) { st.textContent = e.message; });
  }
  $("sv-playlist").addEventListener("click", function (e) {
    var m = e.target.closest("[data-plmode]"), rm = e.target.closest("[data-plrm]"), arm = e.target.closest("[data-plarm]"), sv = e.target.closest("[data-plsave]");
    if (sv && pl) {
      var card = sv.closest(".plcard"), tid = sv.getAttribute("data-plsave");
      sv.disabled = true; say("plMsg", "Saving...");
      req(PLF, { a: "track-edit", show: pl.id, id: tid, title: card.querySelector("[data-pltitle]").value.trim(), artist: card.querySelector("[data-plartist]").value.trim(), free_download: card.querySelector("[data-plfree]").checked })
        .then(function (r) { pl.artist_tracks = r.artist_tracks; plDraw(); say("plMsg", "Saved. The show page picks it up within about 5 minutes."); })
        .catch(function (x) { sv.disabled = false; say("plMsg", x.message); });
      return;
    }
    if (m && pl) { plKeep(); pl.mode = m.getAttribute("data-plmode"); plDraw(); say("plMsg", "Hit Save playlist to make it live."); }
    else if (rm && pl) { plKeep(); pl.tracks.splice(+rm.getAttribute("data-plrm"), 1); plDraw(); say("plMsg", "Hit Save playlist to make it live."); }
    else if (arm && pl) {
      if (!confirm("Take this artist's track out of the playlist? It gets deleted.")) return;
      arm.disabled = true;
      req(PLF, { a: "artist-remove", show: pl.id, id: arm.getAttribute("data-plarm") }).then(function (r) { pl.artist_tracks = r.artist_tracks; plDraw(); say("plMsg", "Removed."); })
        .catch(function (x) { arm.disabled = false; say("plMsg", x.message); });
    }
  });
  $("plSave").addEventListener("click", function () {
    if (!pl) return; plKeep(); say("plMsg", "Saving...");
    req(PLF, { a: "save", show: pl.id, mode: pl.mode, tracks: pl.tracks }).then(function (r) { pl.mode = r.mode; pl.tracks = r.tracks; plDraw(); say("plMsg", "Saved. The show page picks it up within about 5 minutes."); })
      .catch(function (x) { say("plMsg", x.message); });
  });

  $("af").addEventListener("submit", function (e) {
    e.preventDefault(); say("amsg", "Saving...");
    var body = { a: "create", e: cur.event.slug, name: $("aname").value.trim(), spots: Number($("aspots").value) || 0,
      full_name: $("artfull").value.trim(), email: $("artemail").value.trim().toLowerCase(), phone: $("artphone").value.trim() };
    var m2 = { full_name: $("art2full").value.trim(), email: $("art2email").value.trim().toLowerCase(), phone: $("art2phone").value.trim() };
    var duo = !!(m2.full_name || m2.email || m2.phone);
    if (duo && !(body.full_name && body.email && body.phone)) { say("amsg", "For a duo, fill in the first person's name, email and phone too."); return; }
    (pre = {}, req)(ART, body).then(function (r) {
      // Duo: add the second person to the act right after it's created.
      if (!duo) return r;
      return (pre = {}, req)(ART, { a: "member_add", id: r.id, full_name: m2.full_name, email: m2.email, phone: m2.phone })
        .then(function (j) { r.member = j.pass_sent ? "Second person's pass sent to " + m2.email + "." : "Second person added, but their pass email didn't go out."; return r; })
        .catch(function (x) { r.member = "Second person wasn't added: " + x.message + " Use Add a member on the artist."; return r; });
    }).then(function (r) {
      ["aname", "artfull", "artemail", "artphone", "art2full", "art2email", "art2phone"].forEach(function (id) { $(id).value = ""; }); $("aspots").value = "2";
      var lead = r.pass_sent === true ? "Pass sent to " + body.email + ". Link copied too, in case you want to text it."
        : r.pass_sent === false ? "Invite made, but the pass email didn't go out. Use Resend on the Door List. Link copied."
        : "Invite made and link copied. Text it to the artist.";
      if (r.member) lead += " " + r.member;
      (navigator.clipboard ? navigator.clipboard.writeText(r.link) : Promise.reject()).then(function () { say("amsg", lead); }).catch(function () { say("amsg", lead.replace(/ ?Link copied[^.]*\./, "") + " Link: " + r.link); });
      artists();
    }).catch(function (err) { say("amsg", err.message); });
  });
  $("artists").addEventListener("click", function (e) {
    var c = e.target.closest("[data-copy]"), sp = e.target.closest("[data-spots]"), rv = e.target.closest("[data-revoke]"), hd = e.target.closest("[data-hide]");
    var fx = e.target.closest("[data-fans]"), ma = e.target.closest("[data-madd]"), mr = e.target.closest("[data-mrm]");
    if (ma) {
      // Duo/group: another person under the same artist name, with their own pass and link to the same page.
      var act = ma.getAttribute("data-name"), full = prompt("Add a member to " + act + ".\nTheir full name (first and last):"); if (!full) return;
      var phone = prompt("Their phone number:"); if (!phone) return;
      var email = prompt("Their email (their pass goes here):"); if (!email) return;
      ma.disabled = true;
      (pre = {}, req)(ART, { a: "member_add", id: ma.getAttribute("data-madd"), full_name: full.trim(), phone: phone.trim(), email: email.trim().toLowerCase() })
        .then(function (j) { alert(full + " is on " + act + "'s pass." + (j.pass_sent ? " Their pass was emailed." : " The pass email didn't send; copy their link and text it.")); artists(); })
        .catch(function (err) { ma.disabled = false; alert(err.message); });
      return;
    }
    if (mr) {
      if (!confirm("Remove " + mr.getAttribute("data-name") + " from this act? Their artist pass stops working.")) return;
      (pre = {}, req)(ART, { a: "member_remove", id: mr.getAttribute("data-act"), member_id: mr.getAttribute("data-mrm") }).then(artists).catch(function (err) { alert(err.message); });
      return;
    }
    if (fx) { dlCsv(DLS[fx.getAttribute("data-fans")] || [], fx.getAttribute("data-name")); return; }
    if (hd) { hd.disabled = true; (pre = {}, req)(ART, { a: "update", id: hd.getAttribute("data-hide"), profile_hidden: !!hd.getAttribute("data-h") }).then(artists).catch(function (err) { alert(err.message); }); }
    if (c) { var t = c.getAttribute("data-copy"); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { c.textContent = "Copied ✓"; }).catch(function () { prompt("Copy this link:", t); }); }
    if (sp) { sp.disabled = true; (pre = {}, req)(ART, { a: "update", id: sp.getAttribute("data-spots"), spots: Number(sp.getAttribute("data-n")) }).then(artists).catch(function (err) { alert(err.message); }); }
    if (rv) {
      if (!confirm("Cancel " + rv.getAttribute("data-name") + "? Their link stops working, and their artist pass and every guest ticket they added are cancelled.")) return;
      (pre = {}, req)(ART, { a: "revoke", id: rv.getAttribute("data-revoke") }).then(artists).catch(function (err) { alert(err.message); });
    }
  });

  // ---------- promo codes ----------
  function codes() {
    var p = lastSales ? Promise.resolve(lastSales) : sales();
    $("ptable").innerHTML = '<div class="empty">Loading...</div>';
    p.then(function (d) {
      if (!d) return;
      var link = function (c) { return cur.event.page_url + (cur.event.page_url.indexOf("?") < 0 ? "?" : "&") + "code=" + encodeURIComponent(c); };
      $("ptable").innerHTML = d.promos.length ? d.promos.map(function (c) {
        return '<div class="person' + (c.active ? "" : " off") + '"><div><b>' + esc(c.code) + '</b><span class="mono">' + (c.label ? esc(c.label) + " · " : "") + c.orders + " orders · " + c.tickets + " tickets · " + (c.discount_cents ? usd(c.discount_cents) + " off" : "tracking only") + "</span></div>" +
          '<span class="pa"><button type="button" data-copy="' + esc(link(c.code)) + '">Copy link</button></span></div>';
      }).join("") : '<div class="empty">No codes yet.</div>';
    });
  }
  $("ptable").addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]"); if (!b) return;
    var t = b.getAttribute("data-copy");
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { b.textContent = "Copied ✓"; }).catch(function () { prompt("Copy this link:", t); });
  });
  $("promof").addEventListener("submit", function (e) {
    e.preventDefault(); say("pmsg", "Saving...");
    door("promo", { code: $("pcode").value, label: $("plabel").value, discount_dollars: $("poff").value }).then(function () {
      say("pmsg", "Saved. Use Copy link to share it."); $("pcode").value = ""; $("plabel").value = ""; $("poff").value = "0"; lastSales = null; codes();
    }).catch(function (err) { say("pmsg", err.message); });
  });

  // ---------- images: flyers + link preview ----------
  function imgSlot(label, url, kind, night, fallback) {
    return '<div class="slot"><div class="sl mono">' + esc(label) + "</div>" +
      (url || fallback ? '<a href="' + esc(url || fallback) + '" target="_blank" rel="noopener"><img src="' + esc(url || fallback) + '" alt=""></a>' : '<div class="noimg">No image yet</div>') +
      (fallback && !url ? '<div class="fine">Using the built-in image</div>' : "") +
      '<label class="btn ghost up">Upload<input type="file" accept="image/*" data-up="' + kind + '" data-night="' + esc(night || "") + '" hidden></label>' +
      (url ? '<button type="button" class="mini" data-clear="' + kind + '" data-night="' + esc(night || "") + '">' + (fallback ? "Back to built-in" : "Remove") + "</button>" : "") +
      '<div class="msg"></div></div>';
  }
  function drawImages() {
    $("flyers").innerHTML = cur.nights.map(function (n) { return imgSlot(n.label + " flyer", n.flyer_url, "flyer", n.id); }).join("");
    $("shareBox").innerHTML = imgSlot("Link preview", cur.event.share_url, "share", "", cur.event.slug === "underground" ? cur.share_default : null);
  }
  // Shrink on the phone before upload: flyers up to 1600 px tall, previews 1200 px wide, as JPEG.
  function shrink(file, kind) {
    return new Promise(function (ok, no) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, k = kind === "share" ? Math.min(1, 1200 / w) : Math.min(1, 1600 / Math.max(w, h));
        var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
        var x = c.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u); c.toBlob(function (b) { b ? ok(b) : no(new Error("Couldn't read that image.")); }, "image/jpeg", 0.88);
      };
      img.onerror = function () { no(new Error("That file isn't an image this browser can read. Try a JPG or PNG.")); };
      img.src = u;
    });
  }
  function putFile(url, blob, type) {
    return new Promise(function (ok, no) {
      var x = new XMLHttpRequest(); x.open("PUT", url, true); x.setRequestHeader("Content-Type", type);
      x.onload = function () { x.status < 300 ? ok() : no(new Error("Upload failed (" + x.status + ")")); };
      x.onerror = function () { no(new Error("Upload failed. Check the connection.")); };
      x.send(blob);
    });
  }
  $("sv-images").addEventListener("change", function (e) {
    var inp = e.target.closest("[data-up]"); if (!inp || !inp.files[0]) return;
    var kind = inp.getAttribute("data-up"), night = inp.getAttribute("data-night") || null, msg = inp.closest(".slot").querySelector(".msg");
    msg.textContent = "Uploading...";
    shrink(inp.files[0], kind).then(function (blob) {
      return call("media-url", { e: cur.event.slug, kind: kind, night: night }).then(function (r) {
        return putFile(r.url, blob, "image/jpeg").then(function () { return call("media-save", { e: cur.event.slug, kind: kind, night: night, path: r.path }); });
      });
    }).then(function (r) {
      if (kind === "share") cur.event.share_url = r.url; else cur.nights.forEach(function (n) { if (n.id === night) n.flyer_url = r.url; });
      drawImages();
    }).catch(function (err) { msg.textContent = err.message; });
  });
  $("sv-images").addEventListener("click", function (e) {
    var b = e.target.closest("[data-clear]"); if (!b) return;
    var kind = b.getAttribute("data-clear"), night = b.getAttribute("data-night") || null;
    if (!confirm(kind === "share" ? "Go back to the built-in preview image?" : "Remove this flyer from the ticket page?")) return;
    call("media-save", { e: cur.event.slug, kind: kind, night: night, path: null }).then(function () {
      if (kind === "share") cur.event.share_url = null; else cur.nights.forEach(function (n) { if (n.id === night) n.flyer_url = null; });
      drawImages();
    }).catch(function (err) { alert(err.message); });
  });

  // ---------- details: the show's basics + door PIN ----------
  function drawDetails() {
    var e = cur.base || {}, v = function (x) { return esc(x || ""); };
    var dt = function (s) { return s ? new Date(new Date(s).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""; };
    var secret = cur.event.secret;
    $("detailsForm").innerHTML = '<form class="form" id="df" novalidate>' +
      (secret ? '<div class="banner"><div><b>Secret location.</b> ' + (cur.event.address_live ? "The address is live on tickets now." : "The address goes out automatically " + esc(fmt(cur.event.reveal_at)) + ", by email to every ticket holder.") + "</div></div>" : "") +
      '<label>Name</label><input type="text" name="name" value="' + v(e.name || cur.event.name) + '">' +
      '<label>Type</label><select name="kind">' + ["show", "popup", "drop", "other"].map(function (k) { return '<option value="' + k + '"' + ((e.kind || "show") === k ? " selected" : "") + ">" + k + "</option>"; }).join("") + "</select>" +
      (secret ? "" : '<label>Venue</label><input type="text" name="venue" value="' + v(e.venue) + '"><label>Address</label><input type="text" name="address" value="' + v(e.address) + '">') +
      '<label>City</label><input type="text" name="city" value="' + v(e.city) + '">' +
      '<label>Starts</label><input type="datetime-local" name="starts_at" value="' + dt(e.starts_at) + '">' +
      '<label>Ends</label><input type="datetime-local" name="ends_at" value="' + dt(e.ends_at) + '">' +
      (cur.ticketed ? "" : '<label>Tickets / info link</label><input type="url" name="ticket_url" value="' + v(e.ticket_url) + '">') +
      '<label>Stickers printed</label><input type="number" name="stickers" min="0" value="' + (e.stickers || 0) + '">' +
      '<label>Details</label><input type="text" name="description" value="' + v(e.description) + '">' +
      '<button type="submit" class="btn">Save details</button><div class="msg" id="dmsg" role="status"></div>' +
      '<button type="button" class="btn ghost" id="dToggle">' + (e.is_active === false ? "Switch show on" : "Switch show off") + "</button></form>";
    $("pinf").hidden = !cur.ticketed;
  }
  $("detailsForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = ev.target, body = { slug: cur.event.slug };
    [].forEach.call(f.querySelectorAll("[name]"), function (i) { body[i.name] = i.type === "datetime-local" ? (i.value ? new Date(i.value).toISOString() : null) : i.value.trim(); });
    // A secret-location show keeps its venue and address off the public record.
    if (cur.event.secret) { body.venue = cur.base.venue; body.address = cur.base.address; }
    if (cur.ticketed) body.ticket_url = cur.base.ticket_url || null;
    body.is_active = cur.base.is_active !== false; body.is_public = cur.base.is_public !== false;
    say("dmsg", "Saving...");
    call("event", body).then(function () { return reload(); }).then(function () { say("dmsg", "Saved."); }).catch(function (err) { say("dmsg", err.message); });
  });
  $("detailsForm").addEventListener("click", function (ev) {
    if (!ev.target.closest("#dToggle")) return;
    var on = cur.base.is_active === false;
    call("event-toggle", { slug: cur.event.slug, is_active: on }).then(function () { return reload(); }).then(drawDetails).catch(function (err) { alert(err.message); });
  });
  $("pinf").addEventListener("submit", function (e) {
    e.preventDefault(); say("pinmsg", "Saving...");
    door("settings", { pin: $("newpin").value }).then(function () { $("newpin").value = ""; say("pinmsg", "PIN saved. Give it to your door staff."); }).catch(function (err) { say("pinmsg", err.message); });
  });
  function reload() { return call("overview").then(function (d) { paint(d); if (cur) cur.base = d.events.filter(function (x) { return x.slug === cur.event.slug; })[0] || cur.base; }); }

  // ================= TRACKS =================
  function qrBlock(t, events) {
    if (!t.qr_code) return "";
    var svg = FN + "?a=qr.svg&c=" + encodeURIComponent(t.qr_code);
    var opts = (events || []).filter(function (e) { return e.is_active; }).map(function (e) { return '<option value="' + esc(e.slug) + '">' + esc(e.name) + "</option>"; }).join("");
    return '<div class="qr"><img alt="QR code" data-svg="' + esc(svg) + '"><div><div class="mono">' + esc(t.qr_url) + "</div>" +
      '<div class="when">' + num(t.scans.view) + " views · " + num(t.scans.unlocked) + " unlocks</div>" +
      '<a class="btn ghost small" href="' + esc(svg) + '" download="' + esc(t.slug) + '-qr.svg" data-dl>Download QR</a></div></div>' +
      (opts ? '<div class="showqr"><label>Stickers for a show</label><div class="row2"><select>' + opts + "</select>" +
        '<button type="button" class="btn ghost small" data-showqr="' + esc(t.qr_code) + '" data-slug="' + esc(t.slug) + '">Download show QR</button></div>' +
        '<div class="fine">Each show gets its own code, so scans and signups count for that show.</div></div>' : "");
  }
  function trackTools(t) {
    return '<div class="tools">' +
      (t.is_current ? "" : '<button type="button" class="btn ghost small" data-act="track-update" data-slug="' + esc(t.slug) + '" data-set=\'{"is_current":true}\'>Make welcome track</button>') +
      '<button type="button" class="btn ghost small" data-act="track-update" data-slug="' + esc(t.slug) + '" data-set=\'{"qr_active":' + (t.qr_active ? "false" : "true") + '}\'>' + (t.qr_active ? "Switch QR off" : "Switch QR on") + "</button>" +
      '<details class="add"><summary class="btn ghost small">Edit</summary><form class="form" data-edit-track="' + esc(t.slug) + '">' +
      '<label>Title</label><input type="text" name="title" value="' + esc(t.title) + '">' +
      '<label>Artist</label><input type="text" name="artist" value="' + esc(t.artist || "") + '">' +
      '<label>One line</label><input type="text" name="description" value="' + esc(t.description || "") + '">' +
      '<button type="submit" class="btn">Save</button><div class="msg" role="status"></div></form></details></div>';
  }
  $("tracks").addEventListener("click", function (e) {
    var b = e.target.closest("[data-showqr]");
    if (b) {
      var show = b.parentNode.querySelector("select").value, code = b.getAttribute("data-showqr"); b.disabled = true;
      fetch(FN + "?a=qr.svg&c=" + encodeURIComponent(code) + "&e=" + encodeURIComponent(show), { headers: { "x-admin-token": tok } })
        .then(function (r) { return r.blob(); }).then(function (bl) { var a = document.createElement("a"); a.href = URL.createObjectURL(bl); a.download = b.getAttribute("data-slug") + "--" + show + "-qr.svg"; document.body.appendChild(a); a.click(); a.remove(); b.disabled = false; })
        .catch(function () { b.disabled = false; });
      return;
    }
    var act = e.target.closest("[data-act]"); if (!act) return;
    var body = JSON.parse(act.getAttribute("data-set")); body.slug = act.getAttribute("data-slug"); act.disabled = true;
    call(act.getAttribute("data-act"), body).then(reload).catch(function (err) { act.disabled = false; alert(err.message); });
  });
  $("tracks").addEventListener("submit", function (e) {
    var f = e.target.closest("form[data-edit-track]"); if (!f) return;
    e.preventDefault();
    var m = f.querySelector(".msg"), body = { slug: f.getAttribute("data-edit-track") };
    [].forEach.call(f.querySelectorAll("[name]"), function (i) { body[i.name] = i.value.trim(); });
    m.textContent = "Saving..."; call("track-update", body).then(reload).catch(function (err) { m.textContent = err.message; });
  });
  function upload(slug, kind, file, onPct) {
    return call("upload-url", { slug: slug, kind: kind, filename: file.name }).then(function (r) {
      return new Promise(function (res, rej) {
        var x = new XMLHttpRequest(); x.open("PUT", r.url, true);
        x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        x.upload.onprogress = function (e) { if (e.lengthComputable) onPct(e.loaded / e.total); };
        x.onload = function () { x.status < 300 ? res(r.path) : rej(new Error("Upload failed (" + x.status + ")")); };
        x.onerror = function () { rej(new Error("Upload failed. Check the connection.")); };
        x.send(file);
      });
    });
  }
  $("tf").addEventListener("submit", function (e) {
    e.preventDefault();
    var title = $("t_title").value.trim(), artist = $("t_artist").value.trim();
    var src = function (k) { return { file: $("t_" + k).files[0] || null, link: $("t_" + k + "_link").value.trim() || null }; };
    var audio = src("audio"), wav = src("wav"), cover = src("cover");
    if (!title) return say("tmsg", "Add a title.");
    if (!audio.file && !audio.link) return say("tmsg", "Add the streaming file (pick a file or paste a link).");
    if (audio.file && (/\.(wav|aif|aiff|flac)$/i.test(audio.file.name) || audio.file.size > 20 * 1048576)) return say("tmsg", "The streaming file should be an mp3 or m4a under 20 MB. Put the WAV in the WAV slot.");
    if (cover.file && cover.file.size > 3 * 1048576) return say("tmsg", "That cover is over 3 MB. Export it as a JPG around 1400 px.");
    if (wav.file && wav.file.size > 50 * 1048576) return say("tmsg", "That WAV is over 50 MB. Use a 16-bit version.");
    var slug = (artist + " " + title).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    $("t_go").disabled = true;
    var bar = document.createElement("div"); bar.className = "bar"; bar.innerHTML = "<i></i>"; $("tmsg").textContent = ""; $("tmsg").appendChild(bar);
    var note = document.createElement("div"); $("tmsg").appendChild(note);
    var i = bar.firstChild, paths = {};
    var steps = [["audio", audio], ["wav", wav], ["cover", cover]].filter(function (s) { return s[1].file || s[1].link; });
    var n = 0;
    steps.reduce(function (p, s) {
      return p.then(function () {
        var label = { audio: "streaming file", wav: "WAV", cover: "cover" }[s[0]];
        if (s[1].file) { note.textContent = "Uploading the " + label + "..."; return upload(slug, s[0], s[1].file, function (pct) { i.style.width = Math.round(100 * (n + pct) / steps.length) + "%"; }).then(function (path) { paths[s[0]] = path; n++; }); }
        note.textContent = "Pulling the " + label + " from the link (big files take a minute)...";
        return call("import-link", { slug: slug, kind: s[0], url: s[1].link }).then(function (r) { paths[s[0]] = r.path; n++; i.style.width = Math.round(100 * n / steps.length) + "%"; })
          .catch(function (err) { throw new Error("The " + label + " link: " + err.message); });
      });
    }, Promise.resolve()).then(function () {
      note.textContent = "Saving...";
      return call("track", { slug: slug, title: title, artist: artist || null, description: $("t_desc").value.trim() || null,
        audio_path: paths.audio, download_path: paths.wav || null, artwork_path: paths.cover || null, is_current: $("t_current").checked });
    }).then(function (r) {
      say("tmsg", "Added. Its QR code: " + r.qr_url); $("tf").reset(); $("t_go").disabled = false; $("addTrack").open = false;
      return reload();
    }).catch(function (err) { say("tmsg", err.message); $("t_go").disabled = false; });
  });

  // ================= paint everything from the overview =================
  function paint(d) {
    data = d; paintShows(d);
    $("tracks").innerHTML = d.tracks.length ? d.tracks.map(function (t) {
      return '<article class="card' + (t.qr_active ? "" : " off") + '"><span class="chips">' + (t.is_current ? '<span class="chip">Welcome track</span>' : "") + (t.qr_active ? "" : '<span class="chip alt">QR off</span>') + "</span>" +
        "<h3>" + esc(t.title) + "</h3>" + (t.artist ? '<div class="by">' + esc(t.artist) + "</div>" : "") + qrBlock(t, d.events) + trackTools(t) + "</article>";
    }).join("") : '<div class="empty">No tracks yet. Add one below.</div>';
    [].forEach.call($("tracks").querySelectorAll("img[data-svg]"), function (img) {
      fetch(img.getAttribute("data-svg"), { headers: { "x-admin-token": tok } }).then(function (r) { return r.blob(); }).then(function (b) {
        var u = URL.createObjectURL(b); img.src = u; var a = img.parentNode.querySelector("[data-dl]"); if (a) a.href = u;
      }).catch(function () {});
    });
    $("mstats").innerHTML = '<div class="stat"><b>' + num(d.members) + '</b><span>Members</span></div><div class="stat"><b>' + num(d.with_info) + "</b><span>With name, phone, ZIP</span></div>";
    $("atable").querySelector("tbody").innerHTML = d.artists.length ? d.artists.map(function (a) { return "<tr><td>" + esc(a.artist) + '</td><td class="num">' + a.tracks + '</td><td class="num">' + num(a.view) + '</td><td class="num">' + num(a.unlocked) + "</td></tr>"; }).join("") : '<tr><td colspan="4">Nothing yet.</td></tr>';
    $("etable").querySelector("tbody").innerHTML = d.events.length ? d.events.map(function (e) {
      var rate = e.stickers ? Math.round(100 * e.scans.view / e.stickers) + "%" : "–";
      return "<tr><td>" + esc(e.name) + '</td><td class="num">' + num(e.stickers) + '</td><td class="num">' + num(e.scans.view) + '</td><td class="num">' + num(e.scans.unlocked) + '</td><td class="num">' + num(e.scans.joined) + '</td><td class="num">' + rate + "</td></tr>";
    }).join("") : '<tr><td colspan="6">No shows yet.</td></tr>';
    $("ttable").querySelector("tbody").innerHTML = d.tracks.length ? d.tracks.map(function (t) { return "<tr><td>" + esc(t.title) + (t.artist ? " · " + esc(t.artist) : "") + '</td><td class="num">' + num(t.scans.view) + '</td><td class="num">' + num(t.scans.unlocked) + '</td><td class="num">' + num(t.scans.already) + "</td></tr>"; }).join("") : '<tr><td colspan="4">Nothing yet.</td></tr>';
  }

  // ================= MEMBERS =================
  function drawMembers() {
    var q = ($("mq").value || "").toLowerCase();
    var rows = q ? members.filter(function (m) { return [m.email, m.first_name, m.phone, m.zip, m.source].join(" ").toLowerCase().indexOf(q) >= 0; }) : members;
    $("mtable").querySelector("tbody").innerHTML = rows.length ? rows.slice(0, 500).map(function (m) {
      return "<tr><td>" + esc(m.email) + "</td><td>" + esc(m.first_name || "") + "</td><td>" + esc(m.phone || "") + "</td><td>" + esc(m.zip || "") + "</td><td>" + esc(m.source || "") + '</td><td class="num">' + m.tracks + "</td><td>" + esc(S.fmtDate(m.joined)) + "</td></tr>";
    }).join("") : '<tr><td colspan="7">' + (q ? "No matches." : "No members yet.") + "</td></tr>";
  }
  $("mq").addEventListener("input", drawMembers);
  function loadMembers() { call("members").then(function (r) { members = r.members; drawMembers(); }).catch(function () {}); }
  $("csv").addEventListener("click", function () {
    call("members.csv", null, true).then(function (r) { return r.blob(); }).then(function (b) { var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "members.csv"; document.body.appendChild(a); a.click(); a.remove(); });
  });
  $("brevoBtn").addEventListener("click", function () {
    var box = $("brevo"); box.hidden = false; box.innerHTML = "Loading Brevo lists...";
    call("brevo-lists").then(function (r) {
      if (!r.lists.length) { box.innerHTML = "No Brevo lists found. Make one in Brevo first, or check the API key."; return; }
      box.innerHTML = '<div class="sub mono">Brevo list that gets every member</div><select id="blist">' + r.lists.map(function (l) { return '<option value="' + l.id + '"' + (l.id === r.list_id ? " selected" : "") + ">" + esc(l.name) + " (" + l.count + ")</option>"; }).join("") + "</select>" +
        '<div class="row2"><button type="button" class="btn ghost" id="bsave">Use this list</button><button type="button" class="btn" id="bsync">Send everyone now</button></div><div class="msg" id="bmsg"></div>';
      $("bsave").addEventListener("click", function () { call("brevo-list", { list_id: Number($("blist").value) }).then(function () { say("bmsg", "Saved. New signups go to this list automatically."); }).catch(function (e) { say("bmsg", e.message); }); });
      $("bsync").addEventListener("click", function () {
        say("bmsg", "Sending..."); $("bsync").disabled = true;
        call("brevo-sync").then(function (r) { say("bmsg", r.sent + " sent" + (r.failed ? ", " + r.failed + " failed (" + (r.error || "") + ")" : ".")); $("bsync").disabled = false; }).catch(function (e) { say("bmsg", e.message); $("bsync").disabled = false; });
      });
    }).catch(function (e) { box.innerHTML = esc(e.message); });
  });

  // ================= STAFF =================
  function loadStaff() {
    call("admins").then(function (r) {
      var me = ""; try { me = (localStorage.getItem("stack_admin_email") || "").toLowerCase(); } catch (e) {}
      $("staff").innerHTML = r.emails.map(function (e) { return "<li><span>" + esc(e) + (e === me ? ' <span class="chip alt">you</span>' : "") + "</span>" + (e === me ? "" : '<button type="button" data-rm="' + esc(e) + '">Remove</button>') + "</li>"; }).join("");
    }).catch(function () {});
  }
  $("sf").addEventListener("submit", function (e) { e.preventDefault(); call("admin-add", { email: $("s_email").value.trim() }).then(function () { $("s_email").value = ""; say("smsg", "Added. Tell them to join on the homepage with that email, then sign in at /admin."); loadStaff(); }).catch(function (err) { say("smsg", err.message); }); });
  $("staff").addEventListener("click", function (e) { var b = e.target.closest("[data-rm]"); if (!b) return; if (!confirm("Remove " + b.getAttribute("data-rm") + " from staff? They're signed out right away.")) return; call("admin-remove", { email: b.getAttribute("data-rm") }).then(loadStaff).catch(function (err) { say("smsg", err.message); }); });

  // ---------- add a plain show / pop-up ----------
  $("ef").addEventListener("submit", function (e) {
    e.preventDefault(); say("emsg", "Saving...");
    var v = function (id) { return $(id).value.trim() || null; }, local = function (id) { var x = $(id).value; return x ? new Date(x).toISOString() : null; };
    call("event", { name: v("e_name"), kind: $("e_kind").value, venue: v("e_venue"), city: v("e_city"), address: v("e_address"), starts_at: local("e_start"), ends_at: local("e_end"),
      ticket_url: v("e_ticket"), stickers: Number($("e_stickers").value) || 0, description: v("e_desc") })
      .then(function (r) { say("emsg", "Saved. Show link: " + r.show_url); $("ef").reset(); $("addShow").open = false; return reload(); })
      .catch(function (err) { say("emsg", err.message); });
  });

  // ---------- boot ----------
  function boot() {
    // Wake the door and artist services while the overview loads, so the first tab click isn't a cold start.
    fetch(DOOR + "?a=ping").catch(function () {}); fetch(BASE + "artist?a=ping").catch(function () {});
    call("overview").then(function (d) {
      $("login").hidden = true; $("app").hidden = false; $("signout").hidden = false;
      try { $("who").textContent = localStorage.getItem("stack_admin_email") || ""; } catch (e) {}
      paint(d); loadMembers(); loadStaff();
      var h = (location.hash || "").slice(1); show(TABS.indexOf(h) >= 0 ? h : "shows");
    }).catch(function (err) {
      if (err.status === 401) signedOut(); else { $("login").hidden = false; say("lmsg", err.message); }
    });
  }
  S.pageview("/admin");
  if (tok) boot(); else $("login").hidden = false;
})();
