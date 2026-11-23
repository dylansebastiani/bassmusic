/* Subduction for promoters. Rule: one screen, one job, one big button, plain words, phone first.
   Screens: sign in -> home checklist -> brand kit -> the 5 show questions -> show art -> get paid -> send to Subduction. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/promoter", CONNECT = (C.supabaseUrl || "") + "/functions/v1/connect";
  var app = document.getElementById("app");
  var KEY = "stack_admin", tok = ""; try { tok = localStorage.getItem(KEY) || ""; } catch (e) {}
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var me = null, coId = "", draft = null, warns = {};

  function api(url, body) {
    return fetch(url, { method: body ? "POST" : "GET", headers: Object.assign({ "x-admin-token": tok }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (r.status === 401 && tok) { signOut(); throw new Error("Please sign in again."); } if (!r.ok) throw new Error(j.error || "Something went wrong. Try again."); return j; }); });
  }
  var call = function (a, body) { return api(FN, Object.assign({ a: a }, body || {})); };
  function signOut() { tok = ""; try { localStorage.removeItem(KEY); } catch (e) {} location.hash = ""; route(); }
  function say(t, bad) { var m = app.querySelector(".msg"); if (m) { m.textContent = t || ""; m.className = "msg" + (bad ? " bad" : ""); } }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  function company() { return me.companies.find(function (c) { return c.id === coId; }) || me.companies[0]; }
  function showById(id) { return me.shows.find(function (s) { return s.id === id; }); }
  function top(back) { return '<div class="top"><span>' + (back ? '<a class="linkbtn" href="' + back + '">&larr; Back</a>' : "Subduction") + "</span><button type=button id=out>Sign out</button></div>"; }
  function wireTop() { var o = document.getElementById("out"); if (o) o.onclick = signOut; }

  // ---------- sign in ----------
  function signin() {
    app.innerHTML = top() + "<h1>Sell tickets with Subduction</h1><p class=lead>Your email, then the 6-digit code we send you. No passwords.</p>" +
      '<form id=f1 novalidate><label for=em>Email</label><input type=email id=em autocomplete=email inputmode=email autocapitalize=off><button class=btn type=submit>Send my code</button></form>' +
      '<form id=f2 novalidate hidden><label for=cd>6-digit code</label><input type=text id=cd inputmode=numeric autocomplete=one-time-code maxlength=6><button class=btn type=submit>Sign in</button></form><p class=msg role=status></p>';
    var em = document.getElementById("em");
    document.getElementById("f1").onsubmit = function (e) {
      e.preventDefault(); say("Sending…");
      call("login", { email: em.value.trim() }).then(function () { document.getElementById("f1").hidden = true; document.getElementById("f2").hidden = false; document.getElementById("cd").focus(); say("Check your email for the code."); })
        .catch(function (x) { say(x.message, true); });
    };
    document.getElementById("f2").onsubmit = function (e) {
      e.preventDefault(); say("Checking…");
      call("verify", { email: em.value.trim(), code: document.getElementById("cd").value }).then(function (r) { tok = r.token; try { localStorage.setItem(KEY, tok); } catch (x) {} load().then(route); })
        .catch(function (x) { say(x.message, true); });
    };
  }

  // ---------- home: the checklist ----------
  function home() {
    var co = company();
    if (!co) { app.innerHTML = top() + "<h1>Almost there</h1><p class=lead>Your account isn't linked to a crew yet. Message Subduction and we'll set it up.</p>"; wireTop(); return; }
    var shows = me.shows.filter(function (s) { return s.company_id === co.id; });
    var brandDone = !!(co.brand.logo || (co.brand.colors && co.brand.colors.main));
    var s = shows[0];
    var steps = [
      { key: "brand", t: "Your brand", d: "Logo, colors, partner logos. Once, for every show.", done: brandDone, href: "#brand" },
      { key: "show", t: "Your show", d: s ? esc(s.name) : "5 quick questions: dates, place, age, tickets.", done: !!(s && s.checklist.details), href: "#show/" + (s ? s.id : "new") + "/1" },
      { key: "art", t: "Show art", d: "Flyers and art for this show.", done: !!(s && s.checklist.art), href: s ? "#art/" + s.id : "#show/new/1" },
      { key: "paid", t: "Get paid", d: "Connect where ticket money goes. Takes about 5 minutes.", done: co.paid_ready, href: "#paid" },
      { key: "send", t: "Send to Subduction", d: s && s.checklist.submitted ? (s.live ? "Live!" : "We're building your page.") : "We build your page and tell you when it's live.", done: !!(s && s.checklist.submitted), href: s ? "#send/" + s.id : "#show/new/1" },
    ];
    var doneN = steps.filter(function (x) { return x.done; }).length, nextI = steps.findIndex(function (x) { return !x.done; });
    app.innerHTML = top() + (me.companies.length > 1 ? '<label for=co>Crew</label><select id=co>' + me.companies.map(function (c) { return '<option value="' + c.id + '"' + (c.id === co.id ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") + "</select>" : "") +
      "<h1>" + esc(co.name) + '</h1><div class=progress>' + doneN + " of " + steps.length + " done</div>" +
      '<ol class=steps>' + steps.map(function (x, i) { return '<li class="' + (x.done ? "done" : "") + (i === nextI ? " next" : "") + '" data-href="' + x.href + '"><span class=n>' + (x.done ? "&#10003;" : i + 1) + "</span><span><b>" + x.t + "</b><small>" + x.d + "</small></span></li>"; }).join("") + "</ol>" +
      (shows.length > 1 ? "<h2>Your shows</h2>" + shows.map(function (x) { return '<div class=card data-href="#show/' + x.id + '/1"><b>' + esc(x.name) + "</b><small>" + (x.live ? "Live" : x.review_status === "draft" ? "Not sent yet" : "With Subduction") + "</small></div>"; }).join("") : "") +
      (s ? '<a class=ghost href="#show/new/1">+ Another show</a>' : "") +
      (me.owner ? '<h2>Subduction only</h2><details><summary class=ghost>Add a promoter</summary><label for=nc>Crew name</label><input type=text id=nc><label for=ne>Owner email</label><input type=email id=ne autocapitalize=off><button class=btn type=button id=addco>Add</button></details>' : "") +
      "<p class=msg role=status></p>";
    wireTop();
    app.querySelectorAll("[data-href]").forEach(function (el) { el.onclick = function () { go(el.getAttribute("data-href")); }; });
    var sel = document.getElementById("co"); if (sel) sel.onchange = function () { coId = sel.value; home(); };
    var add = document.getElementById("addco");
    if (add) add.onclick = function () {
      call("company-create", { name: document.getElementById("nc").value, owner_email: document.getElementById("ne").value }).then(function (r) { coId = r.company.id; return load(); }).then(home).catch(function (x) { say(x.message, true); });
    };
  }

  // ---------- uploads: big drop boxes that check sizes in plain words ----------
  var SIZES = { logo: [1400, 0, "1400px wide or more, transparent PNG"], hero: [2400, 1600, "2400×1600 or bigger, no text on it"], flyer: [1080, 1350, "1080×1350 or bigger"],
    figure: [800, 0, "Transparent PNG, 800px or more"], partners: [1200, 0, "White logos on transparent, 1200px wide or more"], share: [1200, 630, "Exactly 1200×630"], icon: [300, 300, "Square, 300px or more"], video: [0, 0, "MP4, under 30 seconds"] };
  function drop(id, label, kind, url) {
    var sz = SIZES[kind] || [0, 0, ""];
    return '<div class="drop' + (url ? " has" : "") + '" id="d-' + id + '"><span class=thumb style="background-image:url(' + (url && kind !== "video" ? esc(url) : "") + ')"></span><span><b>' + esc(label) + "</b><small>" + esc(sz[2]) +
      '</small><small class=st>' + (url ? "&#10003; Uploaded" : "Tap to add") + '</small><div class=bar2></div></span><input type=file data-id="' + id + '" data-kind="' + kind + '" accept="' + (kind === "video" ? "video/mp4" : "image/png,image/jpeg,image/webp") + '" aria-label="' + esc(label) + '">' +
      (url ? '<button type=button class=x data-clear="' + id + '" aria-label="Remove">×</button>' : "") + "</div>";
  }
  function checkSize(file, kind) {
    return new Promise(function (ok) {
      var sz = SIZES[kind]; if (!sz || kind === "video" || !sz[0]) return ok("");
      var im = new Image(), u = URL.createObjectURL(file);
      im.onload = function () { URL.revokeObjectURL(u); var w = im.naturalWidth, h = im.naturalHeight;
        ok(w < sz[0] || (sz[1] && h < sz[1]) ? "Heads up: this is " + w + "×" + h + ". It may look soft. Bigger is better if you have it." : ""); };
      im.onerror = function () { ok(""); }; im.src = u;
    });
  }
  function upload(input, scope, onDone) {
    var f = input.files[0]; if (!f) return;
    var box = input.closest(".drop"), st = box.querySelector(".st"), bar = box.querySelector(".bar2"), kind = input.getAttribute("data-kind");
    var ext = (f.name.split(".").pop() || "").toLowerCase();
    if (f.size > (kind === "video" ? 50 : 10) * 1048576) { st.textContent = kind === "video" ? "That video is over 50 MB." : "That image is over 10 MB. Export a smaller copy."; st.className = "st warn"; return; }
    st.textContent = "Uploading…"; st.className = "st";
    checkSize(f, kind).then(function (warn) {
      return call("upload-url", Object.assign({ kind: kind, ext: ext }, scope)).then(function (r) {
        return new Promise(function (ok, no) {
          var x = new XMLHttpRequest(); x.open("PUT", r.upload_url, true); x.setRequestHeader("Content-Type", r.content_type);
          x.upload.onprogress = function (e) { if (e.lengthComputable) bar.style.width = Math.round(e.loaded / e.total * 100) + "%"; };
          x.onload = function () { x.status < 300 ? ok(r.url) : no(new Error("Upload failed. Try again.")); }; x.onerror = function () { no(new Error("Upload failed. Check your connection.")); };
          x.send(f);
        });
      }).then(function (url) { onDone(input.getAttribute("data-id"), url, warn); });
    }).catch(function (e) { st.textContent = e.message; st.className = "st warn"; });
  }

  // ---------- brand kit ----------
  function brand() {
    var co = company(), b = JSON.parse(JSON.stringify(co.brand || {})); b.colors = b.colors || {}; b.socials = b.socials || {}; b.figures = b.figures || [];
    function draw(warnFor, warn) {
      app.innerHTML = top("#") + "<h1>Your brand</h1><p class=lead>Upload it once. Every show you run starts looking like you.</p>" +
        drop("logo", "Logo", "logo", b.logo) + drop("partners", "Partner & sound logos", "partners", b.partners) +
        b.figures.map(function (u, i) { return drop("fig" + i, "Signature art " + (i + 1), "figure", u); }).join("") + (b.figures.length < 6 ? drop("fig" + b.figures.length, "Signature art (characters, cutouts)", "figure", "") : "") +
        "<h2>Your colors</h2><div class=colors>" + [["main", "Main", "#ff5a1f"], ["second", "Second", "#8a2be2"], ["background", "Background", "#050505"]].map(function (c) {
          return '<div><label for="c-' + c[0] + '">' + c[1] + '</label><input type=color id="c-' + c[0] + '" value="' + esc(b.colors[c[0]] || c[2]) + '"></div>'; }).join("") + "</div>" +
        '<label for=ig>Instagram</label><input type=text id=ig placeholder="@yourcrew" value="' + esc(b.socials.instagram || "") + '"><label for=tt>TikTok</label><input type=text id=tt placeholder="@yourcrew" value="' + esc(b.socials.tiktok || "") + '">' +
        '<button class=btn type=button id=save>Save my brand</button><p class=msg role=status></p>';
      wireTop();
      if (warnFor) { if (warn) warns[warnFor] = warn; else delete warns[warnFor]; }
      Object.keys(warns).forEach(function (k) { var w = document.querySelector("#d-" + k + " .st"); if (w && w.textContent.indexOf("Uploaded") >= 0) { w.textContent = "✓ Uploaded. " + warns[k]; w.className = "st warn"; } });
      app.querySelectorAll(".drop input").forEach(function (i) { i.onchange = function () { upload(i, { company: co.id }, function (id, url, warn) { if (id.indexOf("fig") === 0) b.figures[+id.slice(3)] = url; else b[id] = url; collect(); draw(id, warn); }); }; });
      app.querySelectorAll("[data-clear]").forEach(function (x) { x.onclick = function (e) { e.stopPropagation(); var id = x.getAttribute("data-clear"); if (id.indexOf("fig") === 0) b.figures.splice(+id.slice(3), 1); else delete b[id]; collect(); draw(); }; });
      document.getElementById("save").onclick = function () {
        collect(); say("Saving…");
        call("brand-save", { company: co.id, brand: b }).then(function (r) { co.brand = r.brand; say("Saved."); setTimeout(function () { go("#"); }, 500); }).catch(function (x) { say(x.message, true); });
      };
    }
    function collect() {
      ["main", "second", "background"].forEach(function (k) { var el = document.getElementById("c-" + k); if (el) b.colors[k] = el.value; });
      var ig = document.getElementById("ig"), tt = document.getElementById("tt"); if (ig) b.socials.instagram = ig.value; if (tt) b.socials.tiktok = tt.value;
      b.figures = b.figures.filter(Boolean);
    }
    draw();
  }

  // ---------- the 5 show questions (one per screen) ----------
  function isoDate(iso) { return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : ""; }
  function isoTime(iso) { return iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" }) : ""; }
  function startDraft(id) {
    var s = id === "new" ? null : showById(id);
    if (draft && draft.id === (s ? s.id : "new")) return;
    draft = s ? { id: s.id, name: s.name, city: s.city || "", venue: s.venue || "", secret: s.secret, reveal_date: isoDate(s.reveal_at), age: s.age || "",
      nights: s.nights.map(function (n) { return { date: isoDate(n.starts_at), doors: isoTime(n.starts_at), ends: isoTime(n.ends_at) }; }),
      tickets: s.tickets.map(function (t) { return { name: t.name, nights: t.nights, tiers: t.tiers.map(function (r) { return { name: r.name, price: (r.price_cents / 100).toFixed(2).replace(/\.00$/, ""), qty: r.qty }; }) }; }) }
      : { id: "new", name: "", city: "", venue: "", secret: false, reveal_date: "", age: "", nights: [{ date: "", doors: "21:00", ends: "02:00" }], tickets: [] };
  }
  function question(id, step) {
    startDraft(id);
    var d = draft, n = +step || 1, body = "";
    var head = top("#") + '<div class=qnum>Question ' + n + " of 5</div>";
    if (n === 1) body = "<h1>What's the show called?</h1><label for=q>Show name</label><input type=text id=q maxlength=100 value=\"" + esc(d.name) + '" placeholder="e.g. Basement Frequencies Vol. 3">';
    if (n === 2) body = "<h1>When is it?</h1><p class=lead>One block per night. Times are Central.</p>" + d.nights.map(function (x, i) {
      return '<div class=night-row><b>Night ' + (i + 1) + '</b><label for="nd' + i + '">Date</label><input type=date id="nd' + i + '" value="' + esc(x.date) + '"><div class=row2><div><label for="no' + i + '">Doors</label><input type=time id="no' + i + '" value="' + esc(x.doors) + '"></div><div><label for="ne' + i + '">Ends</label><input type=time id="ne' + i + '" value="' + esc(x.ends) + '"></div></div>' +
        (d.nights.length > 1 ? '<button type=button class=linkbtn data-rmn="' + i + '">Remove this night</button>' : "") + "</div>"; }).join("") + (d.nights.length < 6 ? "<button type=button class=ghost id=addn>+ Add another night</button>" : "");
    if (n === 3) body = "<h1>Where?</h1><label for=city>City</label><input type=text id=city value=\"" + esc(d.city) + '" placeholder="Peoria, IL"><label class=toggle><input type=checkbox id=sec' + (d.secret ? " checked" : "") + "> It's a secret location</label>" +
      '<div id=vbox' + (d.secret ? " hidden" : "") + '><label for=venue>Venue</label><input type=text id=venue value="' + esc(d.venue) + '"></div>' +
      '<div id=rbox' + (d.secret ? "" : " hidden") + '><label for=rev>Day the address goes out to ticket holders</label><input type=date id=rev value="' + esc(d.reveal_date) + '"><p class=note>Send us the address privately. It never shows on the page.</p></div>';
    if (n === 4) body = "<h1>Age limit?</h1><div class=choice>" + ["18+", "21+", "All ages"].map(function (a) { return '<button type=button data-age="' + a + '" aria-pressed="' + (d.age === a) + '">' + a + "</button>"; }).join("") + "</div>";
    if (n === 5) {
      if (!d.tickets.length) d.tickets = d.nights.map(function (x, i) { return { name: d.nights.length > 1 ? "Night " + (i + 1) : "General admission", nights: [i], tiers: [{ name: "Early bird", price: "", qty: "" }, { name: "General", price: "", qty: "" }] }; });
      body = "<h1>Tickets & prices</h1><p class=lead>The price you want per ticket. Fees are added on top for the buyer, so you keep your full price.</p>" + d.tickets.map(function (t, i) {
        return '<div class=ticket><label for="tn' + i + '">Ticket name</label><input type=text id="tn' + i + '" value="' + esc(t.name) + '">' +
          (d.nights.length > 1 ? '<label>Good for</label><div class=nights>' + d.nights.map(function (x, j) { return '<button type=button data-tn="' + i + '" data-nn="' + j + '" aria-pressed="' + (t.nights.indexOf(j) >= 0) + '">Night ' + (j + 1) + "</button>"; }).join("") + "</div>" : "") +
          t.tiers.map(function (r, k) { return '<div class=row3><div><label for="rn' + i + "-" + k + '">Price level</label><input type=text id="rn' + i + "-" + k + '" value="' + esc(r.name) + '"></div><div><label for="rp' + i + "-" + k + '">Price $</label><input type=number inputmode=decimal min=1 step=0.01 id="rp' + i + "-" + k + '" value="' + esc(r.price) + '"></div><div><label for="rq' + i + "-" + k + '">How many</label><input type=number inputmode=numeric min=1 id="rq' + i + "-" + k + '" value="' + esc(r.qty) + '"></div></div>'; }).join("") +
          '<button type=button class=linkbtn data-addt="' + i + '">+ Another price level</button>' + (d.tickets.length > 1 ? ' &nbsp; <button type=button class=linkbtn data-rmt="' + i + '">Remove this ticket</button>' : "") + "</div>"; }).join("") +
        '<button type=button class=ghost id=addt>+ Add a ticket' + (d.nights.length > 1 ? " (like an all-nights pass)" : "") + "</button>";
    }
    app.innerHTML = head + body + '<button class=btn type=button id=next>' + (n < 5 ? "Next" : "Save show") + '</button><p class=msg role=status></p>';
    wireTop();
    function collect() {
      var v = function (i) { var el = document.getElementById(i); return el ? el.value : ""; };
      if (n === 1) d.name = v("q").trim();
      if (n === 2) d.nights = d.nights.map(function (x, i) { return { date: v("nd" + i), doors: v("no" + i), ends: v("ne" + i) }; });
      if (n === 3) { d.city = v("city"); d.secret = document.getElementById("sec").checked; d.venue = v("venue"); d.reveal_date = v("rev"); }
      if (n === 5) d.tickets.forEach(function (t, i) { t.name = v("tn" + i); t.tiers.forEach(function (r, k) { r.name = v("rn" + i + "-" + k); r.price = v("rp" + i + "-" + k); r.qty = v("rq" + i + "-" + k); }); });
    }
    app.onclick = function (e) {
      var el = e.target.closest("button"); if (!el) return;
      if (el.id === "addn") { collect(); var last = d.nights[d.nights.length - 1] || {}; d.nights.push({ date: "", doors: last.doors || "21:00", ends: last.ends || "02:00" }); question(id, n); }
      else if (el.hasAttribute("data-rmn")) { collect(); d.nights.splice(+el.getAttribute("data-rmn"), 1); d.tickets = []; question(id, n); }
      else if (el.hasAttribute("data-age")) { d.age = el.getAttribute("data-age"); app.querySelectorAll("[data-age]").forEach(function (b) { b.setAttribute("aria-pressed", b === el); }); }
      else if (el.hasAttribute("data-tn")) { collect(); var t = d.tickets[+el.getAttribute("data-tn")], j = +el.getAttribute("data-nn"), at = t.nights.indexOf(j); if (at >= 0) { if (t.nights.length > 1) t.nights.splice(at, 1); } else t.nights.push(j); t.nights.sort(); question(id, n); }
      else if (el.hasAttribute("data-addt")) { collect(); d.tickets[+el.getAttribute("data-addt")].tiers.push({ name: "", price: "", qty: "" }); question(id, n); }
      else if (el.hasAttribute("data-rmt")) { collect(); d.tickets.splice(+el.getAttribute("data-rmt"), 1); question(id, n); }
      else if (el.id === "addt") { collect(); d.tickets.push({ name: d.nights.length > 1 ? "All-nights pass" : "VIP", nights: d.nights.map(function (x, i) { return i; }), tiers: [{ name: "General", price: "", qty: "" }] }); question(id, n); }
    };
    var sec = document.getElementById("sec"); if (sec) sec.onchange = function () { document.getElementById("vbox").hidden = sec.checked; document.getElementById("rbox").hidden = !sec.checked; };
    document.getElementById("next").onclick = function () {
      collect();
      if (n === 1 && !d.name) return say("Give it a name.", true);
      if (n === 2 && d.nights.some(function (x) { return !x.date || !x.doors; })) return say("Every night needs a date and a doors time.", true);
      if (n === 3 && !d.city.trim()) return say("Which city?", true);
      if (n === 4 && !d.age) return say("Pick one.", true);
      if (n < 5) return go("#show/" + id + "/" + (n + 1));
      say("Saving…");
      var details = { name: d.name, city: d.city, venue: d.venue, secret: d.secret, reveal_date: d.reveal_date, age: d.age, nights: d.nights,
        tickets: d.tickets.map(function (t) { return { name: t.name, nights: t.nights, tiers: t.tiers.filter(function (r) { return r.price && r.qty; }) }; }) };
      call("show-save", id === "new" ? { company: company().id, details: details } : { show: id, details: details })
        .then(function (r) { draft = null; return load().then(function () { go("#art/" + r.show.id); }); }).catch(function (x) { say(x.message, true); });
    };
  }

  // ---------- show art (event kit) ----------
  function art(id) {
    var s = showById(id); if (!s) return go("#");
    var k = JSON.parse(JSON.stringify(s.kit || {})); k.flyers = k.flyers || []; k.figures = k.figures || [];
    function draw(warnFor, warn) {
      app.innerHTML = top("#") + "<h1>Show art</h1><p class=lead>For <b>" + esc(s.name) + "</b>. Add what you have. Your brand fills in the rest, and we finish the page.</p>" +
        s.nights.map(function (n, i) { return drop("flyer" + i, n.label + " flyer", "flyer", k.flyers[i]); }).join("") +
        drop("hero", "Background art", "hero", k.hero) +
        s.nights.map(function (n, i) { return drop("figure" + i, n.label + " cutout / character", "figure", k.figures[i]); }).join("") +
        drop("logo", "A logo just for this show (optional)", "logo", k.logo) + drop("video", "Teaser video (optional)", "video", k.video) +
        '<label for=links>Or send a link instead</label><textarea id=links rows=3 placeholder="Google Drive or Dropbox link with your art. We\'ll upload it for you.">' + esc(k.links || "") + "</textarea>" +
        '<button class=btn type=button id=save>Save art</button><p class=msg role=status></p>';
      wireTop();
      if (warnFor) { if (warn) warns[warnFor] = warn; else delete warns[warnFor]; }
      Object.keys(warns).forEach(function (k) { var w = document.querySelector("#d-" + k + " .st"); if (w && w.textContent.indexOf("Uploaded") >= 0) { w.textContent = "✓ Uploaded. " + warns[k]; w.className = "st warn"; } });
      app.querySelectorAll(".drop input").forEach(function (i) { i.onchange = function () { upload(i, { show: s.id }, function (key, url, warn) { set(key, url); draw(key, warn); }); }; });
      app.querySelectorAll("[data-clear]").forEach(function (x) { x.onclick = function (e) { e.stopPropagation(); set(x.getAttribute("data-clear"), null); draw(); }; });
      document.getElementById("save").onclick = function () {
        k.links = document.getElementById("links").value; say("Saving…");
        call("kit-save", { show: s.id, kit: k }).then(function (r) { s.kit = r.kit; say("Saved."); setTimeout(function () { go("#"); }, 500); }).catch(function (x) { say(x.message, true); });
      };
    }
    function set(key, url) {
      var m = key.match(/^(flyer|figure)(\d)$/);
      if (m) { var arr = m[1] === "flyer" ? k.flyers : k.figures; while (arr.length <= +m[2]) arr.push(null); arr[+m[2]] = url; }
      else if (url) k[key] = url; else delete k[key];
    }
    draw();
  }

  // ---------- get paid ----------
  function paid() {
    var co = company();
    app.innerHTML = top("#") + "<h1>Get paid</h1>" + (co.paid_ready ? "<p class=lead>&#10003; You're all set. Ticket money goes straight to your own account.</p>"
      : "<p class=lead>Ticket money goes straight to your own account. Stripe (the payment company) checks who you are and where to send it. Subduction never holds your money.</p>" +
        (company().can_manage ? '<button class=btn type=button id=st>Connect my bank with Stripe</button>' : "<p class=note>Only the crew's owner can do this step.</p>")) + "<p class=msg role=status></p>";
    wireTop();
    // Just back from Stripe (or still waiting on it): ask Stripe where things stand.
    if (!co.paid_ready && co.can_manage) api(CONNECT + "?a=status&company=" + co.id).then(function (r) { if (r.charges_enabled) { co.paid_ready = true; paid(); } else if (r.connected) say("Stripe is still checking your details. This can take a few minutes."); }).catch(function () {});
    var b = document.getElementById("st");
    if (b) b.onclick = function () { say("Opening Stripe…"); api(CONNECT, { a: "start", company: co.id }).then(function (r) { location.href = r.url; }).catch(function (x) { say(x.message, true); }); };
  }

  // ---------- send to Subduction ----------
  function send(id) {
    var s = showById(id); if (!s) return go("#");
    var missing = []; if (!s.checklist.details) missing.push("the show questions"); if (!company().paid_ready) missing.push("Get paid");
    app.innerHTML = top("#") + (s.checklist.submitted ? "<h1>" + (s.live ? "You're live" : "We've got it") + "</h1><p class=lead>" + (s.live ? "Your page is up and selling." : "We're building your page now. We'll email you the moment it's live.") + "</p>"
      : "<h1>Send to Subduction</h1><p class=lead>We'll build your page from your brand and show art, and let you know when it's live.</p>" +
        (missing.length ? "<p class=note>Still to do first: " + missing.join(" and ") + ".</p>" : "") +
        '<button class=btn type=button id=go' + (s.checklist.details ? "" : " disabled") + ">Send it</button>") + "<p class=msg role=status></p>";
    wireTop();
    var b = document.getElementById("go");
    if (b) b.onclick = function () { say("Sending…"); call("submit", { show: s.id }).then(function () { return load(); }).then(function () { send(id); }).catch(function (x) { say(x.message, true); }); };
  }

  function load() { return api(FN + "?a=me").then(function (r) { me = r; if (!coId || !me.companies.some(function (c) { return c.id === coId; })) coId = (me.companies[0] || {}).id || ""; }); }
  function route() {
    app.onclick = null; warns = {};
    if (!tok) return signin();
    if (!me) return load().then(route).catch(function (e) { if (tok) app.innerHTML = '<p class="msg bad">' + esc(e.message) + "</p>"; });
    var h = location.hash.replace(/^#/, "").split("/");
    window.scrollTo(0, 0);
    if (h[0] === "brand") return brand();
    if (h[0] === "show") return question(h[1] || "new", h[2]);
    if (h[0] === "art") return art(h[1]);
    if (h[0] === "paid") return paid();
    if (h[0] === "send") return send(h[1]);
    home();
  }
  window.addEventListener("hashchange", route);
  // Back from Stripe: refresh where things stand.
  if (/stripe=/.test(location.search)) { try { history.replaceState(null, "", location.pathname + "#paid"); } catch (e) {} }
  route();
})();
