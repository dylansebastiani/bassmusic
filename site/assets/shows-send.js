/* Send a show to the /shows directory. Five steps, no account.
   Everything a person types is put on the page with textContent or esc(), never raw HTML.
   Edit sessions live in sessionStorage for this tab only. The link token is removed from the address bar once it is used. */
(function () {
  var C = window.STACK || {};
  var FN = (C.supabaseUrl || "") + "/functions/v1/directory";
  var $ = function (id) { return document.getElementById(id); };
  var SOUNDS = ["Dubstep", "Riddim", "DnB", "Bass house", "Warehouse", "Halftime", "Other"];
  var AGES = { all: "All ages", "18": "18+", "21": "21+" };
  var S = { flyer: null, pub: null, source: "manual", session: "", edit: false, show: null, flyerUrl: "", pubUrl: "", sounds: [] };
  var step = 1;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function say(id, t) { $(id).textContent = t || ""; }
  function goto(n) {
    step = n;
    ["s1", "s2", "s3", "s4", "s5", "sx"].forEach(function (id) { $(id).hidden = id !== "s" + n; });
    var lis = $("steps").querySelectorAll("li");
    for (var i = 0; i < lis.length; i++) {
      var k = i + 1;
      lis[i].className = k === n ? "on" : k < n ? "past" : "";
      if (k === n) lis[i].setAttribute("aria-current", "step"); else lis[i].removeAttribute("aria-current");
    }
    $("again").hidden = n === 5 || n === 0;
    window.scrollTo(0, 0);
    var h = $("s" + n).querySelector("input,select,button");
    if (h && n !== 5) try { h.focus({ preventScroll: true }); } catch (e) {}
  }
  function showOther(id) {
    ["s1", "s2", "s3", "s4", "s5", "sx"].forEach(function (x) { $(x).hidden = x !== id; });
    $("again").hidden = true;
  }

  // ---------- bot check (same Cloudflare pass the signup form uses) ----------
  var tsLoaded = false, tsToken = null, tsId = null, tsWaiters = [], tsErr = null;
  function tsGot(t) { tsToken = t; var w = tsWaiters; tsWaiters = []; w.forEach(function (f) { f(); }); }
  function loadTurnstile() {
    if (tsLoaded || !C.turnstileSiteKey) return; tsLoaded = true;
    var el = document.createElement("div"); document.body.appendChild(el);
    window.__tsOnload = function () {
      tsId = turnstile.render(el, { sitekey: C.turnstileSiteKey, action: "signup", appearance: "interaction-only", "refresh-expired": "auto",
        callback: tsGot, "expired-callback": function () { tsToken = null; }, "error-callback": function (c) { tsToken = null; tsErr = String(c || "error").slice(0, 20); } });
    };
    var sc = document.createElement("script"); sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__tsOnload&render=explicit"; sc.async = true; document.head.appendChild(sc);
  }
  function tsPass(ms) {
    if (!C.turnstileSiteKey || tsToken) return Promise.resolve();
    loadTurnstile();
    return new Promise(function (res) { tsWaiters.push(res); setTimeout(res, ms); });
  }
  function tsUse(fd) {
    fd.set("turnstile", tsToken || ""); fd.set("ts_err", tsToken ? "" : (tsErr || (tsLoaded ? "no-pass" : "not-loaded")));
    tsToken = null; if (tsId !== null && window.turnstile) turnstile.reset(tsId);
  }

  function call(fd) {
    var opts = { method: "POST" };
    if (fd instanceof FormData) opts.body = fd;
    else { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(fd); }
    return fetch(FN, opts).then(function (r) {
      return r.json().then(function (j) { if (!r.ok && !j.reason) throw new Error(j.error || "Something went wrong. Try again."); j.__status = r.status; return j; });
    });
  }

  // ---------- helpers ----------
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function dayLabel(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ""); if (!m) return "";
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    return DAY[d.getUTCDay()] + " " + MON[d.getUTCMonth()] + " " + d.getUTCDate();
  }
  function todayChicago() {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); } catch (e) { return ""; }
  }
  function img(file) { return file ? URL.createObjectURL(file) : ""; }
  function pick(inputId, imgId, copyId, key) {
    $(inputId).addEventListener("change", function () {
      var f = $(inputId).files && $(inputId).files[0];
      if (!f) return;
      if (f.size > 1572864) { say("m" + (key === "flyer" ? 1 : 3), "That flyer is too big. Keep it under 1.5 MB."); $(inputId).value = ""; return; }
      S[key] = f; say("m" + (key === "flyer" ? 1 : 3), "");
      $(imgId).src = img(f); $(imgId).hidden = false; $(copyId).hidden = true;
    });
  }
  pick("flyer", "flyerprev", "flyercopy", "flyer");
  pick("pubflyer", "pubprev", "pubcopy", "pub");

  function fromNote(k, text) {
    var n = document.querySelector('.from[data-from="' + k + '"]');
    if (n) n.textContent = text ? text : "";
  }
  function clearFrom() { document.querySelectorAll(".from[data-from]").forEach(function (n) { n.textContent = ""; }); }
  function fill(id, v) { if (v != null && v !== "") $(id).value = v; }

  // ---------- step 1 ----------
  function parseLink(url) {
    return call({ a: "parse", url: url }).then(function (j) {
      var f = (j && j.fields) || {}, from = (j && j.from) || {};
      var map = { name: "name", date: "date", city: "city", state: "state", venue: "venue", lineup: "lineup", price: "price" };
      var got = 0;
      Object.keys(map).forEach(function (k) {
        if (f[k]) { fill(map[k], f[k]); fromNote(k, "From the " + (from[k] || "ticket page")); got++; }
      });
      if (got) { S.source = "link"; fromNote("ticket", "You pasted this"); }
      return got;
    }).catch(function () { return 0; });
  }
  $("f1").addEventListener("submit", function (e) {
    e.preventDefault();
    var link = $("link").value.trim();
    if (link && !/^https:\/\//i.test(link)) { say("m1", "The link needs to start with https."); $("link").focus(); return; }
    if (!link && !S.flyer) { say("m1", "Paste a ticket link or add a flyer. Or tap I'll type it in."); return; }
    clearFrom();
    $("ticket").value = link;
    if (S.flyer && !link) S.source = "flyer"; else if (!link) S.source = "manual";
    if (!link) { fromNote("name", S.flyer ? "Reading the flyer isn't on yet. Type these in." : ""); goto(2); return; }
    $("go1").disabled = true; say("m1", "Reading your link.");
    parseLink(link).then(function (got) {
      $("go1").disabled = false; say("m1", "");
      if (!got) say("m2", "We couldn't read that link, so type it in. It takes a minute.");
      else say("m2", "");
      goto(2);
    });
  });
  $("typeit").addEventListener("click", function () { S.source = "manual"; clearFrom(); say("m2", ""); goto(2); });

  // ---------- step 2 ----------
  function collect() {
    var secretOn = $("secret").checked;
    return {
      name: $("name").value.trim(), date: $("date").value, state: $("state").value, city: $("city").value.trim(), venue: $("venue").value.trim(),
      lineup: $("lineup").value.trim(), price: $("price").value.trim(), ticket_url: $("ticket").value.trim(),
      sounds: S.sounds.slice(0, 3), artist_socials: $("socials").value.trim(), promoter_ig: $("pig").value.trim(), age: $("age").value,
      venue_secret: secretOn ? "1" : "", secret_reveal: secretOn ? $("reveal").value : "", source: S.source,
    };
  }
  $("f2").addEventListener("submit", function (e) {
    e.preventDefault();
    var d = collect(), today = todayChicago();
    if (!d.name) { say("m2", "Add the show name."); $("name").focus(); return; }
    if (!d.date || (today && d.date < today)) { say("m2", "Add a date that is today or later."); $("date").focus(); return; }
    if (!d.city) { say("m2", "Add the city."); $("city").focus(); return; }
    if (!d.state) { say("m2", "Pick a state."); $("state").focus(); return; }
    if (!d.venue) { say("m2", "Add the venue."); $("venue").focus(); return; }
    if (!/^https:\/\//i.test(d.ticket_url)) { say("m2", "Add a ticket link that starts with https."); $("ticket").focus(); return; }
    say("m2", ""); paintCard(); goto(3);
  });
  document.querySelectorAll("[data-back]").forEach(function (b) {
    b.addEventListener("click", function () { goto(Number(b.getAttribute("data-back"))); });
  });

  // ---------- step 3 ----------
  $("sounds").innerHTML = SOUNDS.map(function (s) {
    return '<label><input type="checkbox" value="' + esc(s) + '"><span>' + esc(s) + "</span></label>";
  }).join("");
  $("sounds").addEventListener("change", function (e) {
    var boxes = $("sounds").querySelectorAll("input");
    var on = [];
    boxes.forEach(function (b) { if (b.checked) on.push(b.value); });
    if (on.length > 3) { e.target.checked = false; on.splice(on.indexOf(e.target.value), 1); say("m3", "Pick up to 3 sounds."); } else say("m3", "");
    S.sounds = on;
  });
  function setSounds(list) {
    S.sounds = (list || []).slice(0, 3);
    $("sounds").querySelectorAll("input").forEach(function (b) { b.checked = S.sounds.indexOf(b.value) !== -1; });
  }
  $("secret").addEventListener("change", function () { $("revealbox").hidden = !$("secret").checked; paintCard(); });
  ["name", "date", "city", "state", "reveal"].forEach(function (id) { $(id).addEventListener("input", paintCard); });
  $("secret").addEventListener("input", paintCard);

  // What the public card shows: flyer, date, name, city, and "Secret location" when it applies. Nothing else.
  function paintCard() {
    var d = collect(), box = $("card");
    box.textContent = "";
    var src = S.pubUrl || (S.pub && img(S.pub)) || S.flyerUrl || (S.flyer && img(S.flyer)) || "";
    if (src) { var im = document.createElement("img"); im.src = src; im.alt = ""; box.appendChild(im); }
    else { var bl = document.createElement("div"); bl.className = "blank"; box.appendChild(bl); }
    var w = document.createElement("p"); w.textContent = dayLabel(d.date) || "Date"; box.appendChild(w);
    var n = document.createElement("p"); n.textContent = d.name || "Show name"; n.style.fontWeight = "700"; box.appendChild(n);
    var c = document.createElement("p"); c.textContent = [d.city, d.state].filter(Boolean).join(", ") || "City"; box.appendChild(c);
    if (d.venue_secret) { var t = document.createElement("span"); t.className = "tag"; t.textContent = "Secret location"; box.appendChild(t); }
  }
  $("f3").addEventListener("submit", function (e) {
    e.preventDefault();
    if (S.edit) { save(); return; }
    $("email").value = $("email").value || ""; goto(4);
  });

  // ---------- step 4: send ----------
  function body() {
    var d = collect(), fd = new FormData();
    Object.keys(d).forEach(function (k) {
      if (k === "sounds") fd.set(k, JSON.stringify(d[k])); else fd.set(k, d[k]);
    });
    if (S.flyer) fd.set("flyer", S.flyer);
    if (S.pub) fd.set("public_flyer", S.pub);
    return fd;
  }
  $("email").addEventListener("focus", loadTurnstile, { once: true });
  $("f4").addEventListener("submit", function (e) {
    e.preventDefault();
    var em = $("email").value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(em)) { say("m4", "That email doesn't look right."); $("email").focus(); return; }
    var trap = $("hp_field");
    $("go4").disabled = true; say("m4", "Sending.");
    tsPass(8000).then(function () {
      var fd = body();
      fd.set("a", "submit"); fd.set("email", em); fd.set("hp_field", trap ? trap.value : "");
      tsUse(fd);
      return call(fd);
    }).then(function (j) {
      // No session means the link is already on the list. The reply is the same neutral line either way.
      if (j.neutral || !j.session) { say("m4", j.message || "We'll email you if anything's needed."); $("go4").disabled = false; return; }
      S.session = j.session || "";
      try { if (S.session) sessionStorage.setItem("show_edit", S.session); } catch (x) {}
      say("m4", ""); $("go4").disabled = false;
      $("mailnote").textContent = "We sent an edit link to " + em + ". It works once and stops after 7 days.";
      return loadMine();
    }).catch(function (err) { say("m4", err.message || "Couldn't send that. Try again."); $("go4").disabled = false; });
  });

  // ---------- step 5: status and promo kit ----------
  function stage5(show) {
    S.show = show;
    var live = show.stage === "live", rejected = show.stage === "rejected";
    $("t5").innerHTML = live ? "You're <em>live.</em>" : rejected ? "Not this <em>time.</em>" : "Got <em>it.</em>";
    var items = [["Received", true], ["In review", !live], ["Live", live]];
    if (rejected) items = [["Received", true], ["Not listed this time", true]];
    var done = live ? 2 : 1;
    $("track").innerHTML = items.map(function (it, i) {
      var note = it[0] === "In review" && !live ? (show.was_live ? "Your change is waiting for a look. It's off the list until then." : "We look at every show before it goes up.") : "";
      return '<li class="' + (i <= done || rejected ? "on" : "") + '"><b>' + esc(it[0]) + "</b>" + esc(note) + "</li>";
    }).join("");
    var kit = $("kit");
    if (show.kit && !show.kit.locked) {
      kit.className = "kit";
      kit.innerHTML = '<b class="disp">Promo kit</b><p class="fine">Share your listing and make a story graphic from your flyer.</p>' +
        '<button class="btn" type="button" id="kshare">Share link</button><button class="btn ghost" type="button" id="kstory">Story graphic (1080x1920)</button><p class="msg" id="mk" role="status"></p>';
      $("kshare").addEventListener("click", function () { shareLink(show.kit.share_url); });
      $("kstory").addEventListener("click", function () { story(show); });
    } else {
      kit.className = "kit locked";
      kit.innerHTML = '<b class="disp">Promo kit</b><p class="fine">Locked until the show is approved. Then you get a share link and a story graphic made from your flyer.</p>';
    }
    goto(5);
  }
  function shareLink(u) {
    if (navigator.share) { navigator.share({ url: u }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { $("mk").textContent = "Link copied."; }, function () { $("mk").textContent = u; });
    else $("mk").textContent = u;
  }
  function story(show) {
    var src = show.kit.story_flyer;
    if (!src) { $("mk").textContent = "Add a flyer to your show first. Tap Edit my show."; return; }
    var im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = function () {
      var c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
      var x = c.getContext("2d");
      x.fillStyle = "#000"; x.fillRect(0, 0, 1080, 1920);
      var w = 1080, h = Math.round(im.height * (w / im.width));
      if (h > 1500) { h = 1500; w = Math.round(im.width * (h / im.height)); }
      x.drawImage(im, Math.round((1080 - w) / 2), Math.round((1920 - h) / 2) - 40, w, h);
      x.fillStyle = "#b6ff00"; x.font = "64px Anton, Impact, sans-serif"; x.textAlign = "center";
      x.fillText("TICKETS: LINK IN BIO", 540, 1800);
      c.toBlob(function (b) {
        if (!b) { $("mk").textContent = "Couldn't make that. Try again."; return; }
        var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "story.png"; document.body.appendChild(a); a.click(); a.remove();
      }, "image/png");
    };
    im.onerror = function () { $("mk").textContent = "Couldn't load the flyer. Try again."; };
    im.src = src;
  }
  function loadMine() {
    return call({ a: "mine", s: S.session }).then(function (j) { stage5(j.show); });
  }

  // ---------- edit ----------
  function load(show) {
    fill("name", show.name); fill("date", show.date); fill("state", show.state); fill("city", show.city); fill("venue", show.venue);
    fill("lineup", show.lineup); fill("price", show.price); fill("ticket", show.ticket_url);
    fill("socials", show.artist_socials); fill("pig", show.promoter_ig); $("age").value = show.age || "";
    $("secret").checked = !!show.venue_secret; $("revealbox").hidden = !show.venue_secret;
    $("reveal").value = show.secret_reveal_at ? toChicagoLocal(show.secret_reveal_at) : "";
    setSounds(show.sounds); S.flyerUrl = show.flyer || ""; S.pubUrl = show.public_flyer || ""; S.source = "manual";
    if (S.flyerUrl) { $("flyerprev").src = S.flyerUrl; $("flyerprev").hidden = false; $("flyercopy").hidden = true; }
    if (S.pubUrl) { $("pubprev").src = S.pubUrl; $("pubprev").hidden = false; $("pubcopy").hidden = true; }
    clearFrom();
  }
  function toChicagoLocal(iso) {
    try {
      var p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
      return p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute;
    } catch (e) { return ""; }
  }
  function startEdit() {
    S.edit = true; loadTurnstile(); load(S.show); $("go3").textContent = "Save changes"; paintCard();
    $("m2").textContent = S.show.stage === "live" ? "This show is live. A change goes back for a look first." : "";
    goto(2);
  }
  $("editbtn").addEventListener("click", startEdit);
  function save() {
    $("go3").disabled = true; say("m3", "Saving.");
    tsPass(8000).then(function () {
      var fd = body(); fd.set("a", "edit"); fd.set("s", S.session); tsUse(fd);
      return call(fd);
    }).then(function (j) {
      $("go3").disabled = false; say("m3", "");
      $("mailnote").textContent = j.requeued ? "Saved. It's back in the queue for a look." : "Saved.";
      S.edit = false; S.flyer = null; S.pub = null; $("go3").textContent = "Next";
      stage5(j.show);
    }).catch(function (err) { say("m3", err.message || "Couldn't save that. Try again."); $("go3").disabled = false; });
  }
  $("another").addEventListener("click", function () {
    try { sessionStorage.removeItem("show_edit"); } catch (e) {}
    location.href = "/shows-send";
  });

  // ---------- a new link ----------
  function showRelink(title, line) {
    $("tx").innerHTML = title; $("px").textContent = line; showOther("sx");
    $("emailx").addEventListener("focus", loadTurnstile, { once: true });
  }
  $("relink").addEventListener("click", function (e) { e.preventDefault(); showRelink("Get a new <em>link.</em>", "Type the email you used. If it has a show, we send a new link."); });
  $("fx").addEventListener("submit", function (e) {
    e.preventDefault();
    var em = $("emailx").value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(em)) { say("mx", "That email doesn't look right."); return; }
    say("mx", "Sending.");
    tsPass(8000).then(function () {
      var fd = new FormData(); fd.set("a", "link"); fd.set("email", em); fd.set("hp_field", $("hp_x").value);
      tsUse(fd); return call(fd);
    }).then(function () { say("mx", "If that email has a show, a new link is on its way. It works once and lasts 7 days."); })
      .catch(function (err) { say("mx", err.message || "Couldn't send that. Try again."); });
  });

  // ---------- start ----------
  var k = new URLSearchParams(location.search).get("k") || "";
  var saved = ""; try { saved = sessionStorage.getItem("show_edit") || ""; } catch (e) {}
  if (/^[0-9a-f]{64}$/.test(k)) {
    history.replaceState(null, "", "/shows-send");
    call({ a: "open", k: k }).then(function (j) {
      if (!j.ok) {
        var gone = j.reason === "used" ? "That link was already used." : j.reason === "expired" ? "That link ran out." : "That link isn't right.";
        showRelink("Get a new <em>link.</em>", gone + " Type your email and we'll send a new one.");
        return;
      }
      S.session = j.session; try { sessionStorage.setItem("show_edit", S.session); } catch (e) {}
      S.show = j.show; $("mailnote").textContent = "";
      startEdit();
    }).catch(function () { showRelink("Get a new <em>link.</em>", "We couldn't open that link. Type your email and we'll send a new one."); });
  } else if (/^[0-9a-f]{64}$/.test(saved)) {
    S.session = saved;
    loadMine().catch(function () { try { sessionStorage.removeItem("show_edit"); } catch (e) {} S.session = ""; goto(1); });
  } else goto(1);
})();
