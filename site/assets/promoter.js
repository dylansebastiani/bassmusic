/* Subduction for promoters. Rule: one screen, one job, one big button, plain words, phone first.
   Screens: sign in -> home checklist -> brand kit -> the 5 show questions -> show art -> get paid -> send to Subduction. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/promoter", CONNECT = (C.supabaseUrl || "") + "/functions/v1/connect";
  var app = document.getElementById("app");
  if (window.Stack) Stack.pageview("/promoter");
  var KEY = "stack_admin", tok = ""; try { tok = localStorage.getItem(KEY) || ""; } catch (e) {}
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var me = null, coId = "", draft = null, warns = {}, flash = "";

  function api(url, body) {
    return fetch(url, { method: body ? "POST" : "GET", headers: Object.assign({ "x-admin-token": tok }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (r.status === 403 && j.no_crew) { try { localStorage.setItem("me_tab", "crew"); } catch (e) {} location.replace("me.html"); return new Promise(function () {}); } if (r.status === 401 && tok) { signOut(); throw new Error("Please sign in again."); } if (!r.ok) throw new Error(j.error || "Something went wrong. Try again."); return j; }); });
  }
  var call = function (a, body) { return api(FN, Object.assign({ a: a }, body || {})); };
  function signOut() { tok = ""; try { localStorage.removeItem(KEY); } catch (e) {} location.hash = ""; route(); }
  function say(t, bad) { var m = app.querySelector(".msg"); if (m) { m.textContent = t || ""; m.className = "msg" + (bad ? " bad" : ""); } }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  function company() { return me.companies.find(function (c) { return c.id === coId; }) || me.companies[0]; }
  function showById(id) { return me.shows.find(function (s) { return s.id === id; }); }
  function homeHref() { return me && me.owner ? "#co/" + coId : "#"; }
  function top(back) {
    var home = '<a class="brand" href="/" aria-label="Subduction home"><img src="assets/logo.png" alt=""></a>';
    return '<div class="top">' + (back ? '<a class="linkbtn" href="' + back + '">&larr; Back</a>' : home) + (tok ? "<button type=button id=out>Sign out</button>" : "") + "</div>";
  }
  // Setup is one straight line: 1 Your show, 2 Your flyer, 3 Get paid, then send. Every screen says where you are.
  function stepHead(n, label, extra) {
    return '<div class=wiz>' + [1, 2, 3].map(function (i) { return '<i class="' + (i <= n ? "on" : "") + '"></i>'; }).join("") + '</div><div class=qnum>Step ' + n + " of 3 · " + label + (extra ? " · " + extra : "") + "</div>";
  }
  function firstShow() { var co = company(); return co ? me.shows.filter(function (s) { return s.company_id === co.id; })[0] : null; }
  function wireTop() { var o = document.getElementById("out"); if (o) o.onclick = signOut; }
  function money(cents) { return "$" + ((Number(cents) || 0) / 100).toFixed(2); }
  function referralHtml(co) {
    var r = co && co.referral;
    if (!r || !r.code) return "";
    var rows = (r.rows || []).map(function (x) {
      var state = x.status === "settled" ? "Paid" : "Pending";
      var mark = me.owner && x.status === "pending" ? '<button type=button class=ghost data-settle="' + esc(x.id) + '">Mark this paid</button>' : "";
      return '<div class=card><b>' + esc(x.crew) + "</b><small>" + esc(x.show) + " · " + x.tickets + " paid " + (x.tickets === 1 ? "ticket" : "tickets") + " · " + money(x.credit_cents) + " · " + state + (x.note ? ". " + esc(x.note) : "") + "</small>" + mark + "</div>";
    }).join("");
    var owed = r.pending_cents ? "<p class=note>Pending " + money(r.pending_cents) + ".</p>" : "";
    var how = me.owner && (r.rows || []).some(function (x) { return x.status === "pending"; }) ? "<p class=note>Mark paid only updates this list. It does not send money.</p>" : "";
    return "<h2>Referral link</h2><p class=note>" + esc(r.line || "") + "</p>" +
      '<div class=card><span class=refcode>' + esc(r.link) + '</span><button type=button class=ghost id=copyref>Copy link</button></div>' + owed + rows + how;
  }
  function wireReferral(co) {
    var copy = document.getElementById("copyref");
    if (copy && co.referral) copy.onclick = function () {
      var link = co.referral.link, done = function () { say("Copied."); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { say(link); });
      else say(link);
    };
    app.querySelectorAll("[data-settle]").forEach(function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation(); b.disabled = true;
        call("referral-settle", { credit: b.getAttribute("data-settle") })
          .then(function () { flash = "Marked paid. No money was sent."; return load(); }).then(route)
          .catch(function (x) { say(x.message, true); b.disabled = false; });
      };
    });
  }

  // ---------- sign in ----------
  function signin() {
    var DEMO = FN.replace(/\/promoter$/, "/demo");
    app.innerHTML = top() + "<h1>Sell tickets with Subduction</h1><p class=lead>Type your email. If you already throw shows with us, we send a button that signs you straight in. If you're new, we save your email and write you back. No codes and no passwords.</p>" +
      '<form id=f1 novalidate><label for=em>Email</label><input type=email id=em autocomplete=email inputmode=email autocapitalize=off>' +
      '<input class=hp type=text id=hp_field name=hp_field tabindex=-1 autocomplete=off aria-hidden=true>' +
      '<button class=btn type=submit>Send my email</button></form>' +
      '<div id=sent hidden><div class=card><b id=senttitle>Got it</b><small id=sentmsg></small></div><button class=linkbtn type=button id=again>Send it again</button></div>' +
      '<p class=msg role=status></p><p class=note id=newhere>First time here. <a href=demo.html>Try a test ticket first</a>. It takes a minute and opens your account at the end.</p>';
    var em = document.getElementById("em");
    function showSent(v, fromDemo) {
      document.getElementById("f1").hidden = true; document.getElementById("newhere").hidden = true; document.getElementById("sent").hidden = false;
      document.getElementById("senttitle").textContent = fromDemo ? "Check your email" : "Got it";
      document.getElementById("sentmsg").textContent = fromDemo
        ? "We sent a sign-in button to " + v + ". Open it on this phone and tap the button."
        : "If you already have a promoter account, a sign-in button is on its way to " + v + ". If you're new, we saved that email and we'll write you back.";
      say("");
    }
    function sendLink() {
      var v = em.value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) return say("Check your email address.", true);
      var trap = document.getElementById("hp_field");
      if (trap && trap.value) return showSent(v, false);
      say("Sending…");
      var A = (window.Stack && Stack.attr) || {};
      var pref = String(A.pref || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
      var lead = { a: "lead", email: v, hp_field: trap ? trap.value : "", source: window.Stack && Stack.source ? Stack.source() : "direct",
        utm_source: A.utm_source || null, utm_medium: A.utm_medium || null, utm_campaign: A.utm_campaign || null, referrer: A.referrer || null,
        referral_code: /^[a-z0-9]{8}$/.test(pref) ? pref : null };
      fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lead) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong. Try again."); }); })
        .then(function () { return fetch(DEMO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: "signin", email: v }) }).catch(function () {}); })
        .then(function () { showSent(v, false); })
        .catch(function (x) { say(x.message, true); });
    }
    document.getElementById("f1").onsubmit = function (e) { e.preventDefault(); sendLink(); };
    document.getElementById("again").onclick = function () { sendLink(); };
    // Coming from the demo without the email's key: the button is already on its way.
    var pe = ""; try { pe = sessionStorage.getItem("promo_email") || ""; sessionStorage.removeItem("promo_email"); } catch (x) {}
    if (pe) { em.value = pe; showSent(pe, true); }
  }

  // ---------- home: the checklist ----------
  function home() {
    var co = company();
    // No promoter crew here: their crew may run on the original account (it has its own view on My account),
    // or they're a fan or artist. Same saved sign-in, so My account opens already signed in.
    if (!co) { location.replace("me.html"); return; }
    var shows = me.shows.filter(function (s) { return s.company_id === co.id; });
    var brandDone = !!(co.brand.logo || (co.brand.colors && co.brand.colors.main));
    var s = shows[0];
    var steps = [
      { key: "show", t: "Your show", d: s ? esc(s.name) : "5 quick questions: dates, place, age, tickets.", done: !!(s && s.checklist.details), href: "#show/" + (s ? s.id : "new") + "/1" },
      { key: "art", t: "Your flyer", d: "Drop in your flyer. Any size works.", done: !!(s && s.checklist.art), href: s ? "#art/" + s.id : "#show/new/1" },
      { key: "paid", t: "Get paid", d: "Connect where ticket money goes. Takes about 5 minutes.", done: co.paid_ready, href: "#paid" },
      { key: "send", t: "Send it", d: s && s.checklist.submitted ? (s.live ? "Live!" : "We're building your page.") : "One tap. We build your page and tell you when it's live.", done: !!(s && s.checklist.submitted), href: s ? "#send/" + s.id : "#show/new/1" },
    ];
    var doneN = steps.filter(function (x) { return x.done; }).length, nextI = steps.findIndex(function (x) { return !x.done; });
    if (!s && !me.owner) {
      app.innerHTML = top() + "<div class=qnum>Welcome</div><h1>" + esc(co.name) + ", you're in.</h1><p class=lead>Three quick things and your show is ready to sell. About 5 minutes.</p>" +
        '<ol class="steps plain"><li><span class=n>1</span><span><b>Your show</b><small>Name, date, place, ticket prices.</small></span></li><li><span class=n>2</span><span><b>Your flyer</b><small>Drop it in. Any size.</small></span></li><li><span class=n>3</span><span><b>Get paid</b><small>Connect your bank so ticket money goes straight to you.</small></span></li></ol>' +
        '<a class=btn href="#show/new/1">Start with my show</a><p class=note>You can stop any time. It saves as you go.</p>' + referralHtml(co) + '<p class=msg role=status></p>';
      wireTop(); wireReferral(co); return;
    }
    app.innerHTML = top(me.owner ? "#" : "") + (me.owner ? '<div class=qnum>Setting up for</div>' : "") +
      "<h1>" + esc(co.name) + '</h1><div class=progress>' + doneN + " of " + steps.length + " done</div>" +
      (nextI >= 0 && !me.owner ? '<a class=btn href="' + steps[nextI].href + '">Keep going: ' + steps[nextI].t + "</a>" : "") +
      '<ol class=steps>' + steps.map(function (x, i) { return '<li class="' + (x.done ? "done" : "") + (i === nextI ? " next" : "") + '" data-href="' + x.href + '"><span class=n>' + (x.done ? "&#10003;" : i + 1) + "</span><span><b>" + x.t + "</b><small>" + x.d + "</small></span></li>"; }).join("") + "</ol>" +
      (co.paid_ready ? '<div class=card><b>Your money</b><small>' + StackSavings.stripeNote() + "</small></div>" : "") +
      (shows.some(function (x) { return x.sales && x.sales.count; }) ? "<h2>What you kept</h2>" + shows.map(function (x) { return "<div class=card><b>" + esc(x.name) + "</b>" + StackSavings.line(x.sales) + "</div>"; }).join("") : "") +
      (shows.length > 1 ? "<h2>Your shows</h2>" + shows.map(function (x) { return '<div class=card data-href="#show/' + x.id + '/1"><b>' + esc(x.name) + "</b><small>" + (x.live ? "Live" : x.review_status === "draft" ? "Not sent yet" : "With Subduction") + "</small></div>"; }).join("") : "") +
      (shows.length ? "<h2>Street team</h2>" + shows.map(function (x) { return '<div class=card data-href="#links/' + x.id + '"><b>' + esc(x.name) + "</b><small>Named links, tickets, and what you owe.</small></div>"; }).join("") : "") +
      '<div class=card data-href="#brand"><b>Your brand' + (brandDone ? " &#10003;" : "") + '</b><small>Optional. Your logo and colors on every show. Skip it and your page starts in our neon look.</small></div>' +
      referralHtml(co) +
      (s ? '<div class=card data-href="#music/' + s.id + '"><b>Show music</b><small>Optional. Pick what plays on your page: your own tracks, or Subduction tracks.</small></div>' : "") +
      (s ? '<a class=ghost href="#show/new/1">+ Another show</a>' : "") +
      (me.owner ? '<h2>Invite them</h2><p class=note>' + (co.contact_email ? "We email " + esc(co.contact_email) + " a button that signs them straight in here." : "Add their email and we send them a button that signs them straight in here.") + '</p>' +
        '<label for=ie>Their email</label><input type=email id=ie autocapitalize=off inputmode=email value="' + esc(co.contact_email || "") + '"><button class=btn type=button id=inv>' + (co.contact_email ? "Send invite again" : "Send invite") + "</button>" : "") +
      "<p class=msg role=status></p>";
    wireTop();
    app.querySelectorAll("[data-href]").forEach(function (el) { el.onclick = function () { go(el.getAttribute("data-href")); }; });
    if (flash) { say(flash); flash = ""; }
    wireReferral(co);
    var inv = document.getElementById("inv");
    if (inv) inv.onclick = function () {
      var em = document.getElementById("ie").value.trim(); say("Sending…");
      call("invite", { company: co.id, email: em }).then(function (r) { co.contact_email = r.invited; flash = "Invite sent to " + r.invited + "."; home(); }).catch(function (x) { say(x.message, true); });
    };
  }

  // ---------- Dylan's front page: every promoter, and adding a new one ----------
  function promoters() {
    var list = me.companies;
    app.innerHTML = top() + "<h1>Your promoters</h1><p class=lead>Add a promoter, then fill in their brand and show yourself, or send them this page to do it.</p>" +
      '<div class=ticket><label for=nc>Crew name</label><input type=text id=nc maxlength=80 placeholder="e.g. Basement Frequencies">' +
      '<label for=ne>Their email (optional)</label><input type=email id=ne autocapitalize=off inputmode=email placeholder="Blank = you fill it in">' +
      '<button class=btn type=button id=addco>Add promoter</button><p class=msg role=status></p></div>' +
      (list.length ? "<h2>Promoters</h2>" + list.map(function (c) {
        var n = me.shows.filter(function (x) { return x.company_id === c.id; }), w = n.filter(function (x) { return x.review_status === "submitted"; }).length;
        var pend = c.referral && c.referral.pending_cents ? " · Referral credit pending " + money(c.referral.pending_cents) : "";
        return '<div class=card data-href="#co/' + c.id + '"><b>' + esc(c.name) + "</b><small>" + (w ? w + " sent to you" : n.length ? n.length + " show" + (n.length > 1 ? "s" : "") : "Nothing filled in yet") + pend + "</small></div>"; }).join("") : "");
    wireTop();
    app.querySelectorAll("[data-href]").forEach(function (el) { el.onclick = function () { go(el.getAttribute("data-href")); }; });
    document.getElementById("addco").onclick = function () {
      var nm = document.getElementById("nc").value.trim(); if (!nm) return say("What's the crew called?", true);
      say("Adding…");
      var em2 = document.getElementById("ne").value.trim();
      call("company-create", { name: nm, owner_email: em2 }).then(function (r) { flash = r.invited ? "Added. Invite sent to " + em2 + "." : em2 ? "Added, but the email didn't send. Use Send invite below." : "Added. Fill it in, or add their email below to invite them."; return load().then(function () { go("#co/" + r.company.id); }); }).catch(function (x) { say(x.message, true); });
    };
  }

  // ---------- uploads: big drop boxes that check sizes in plain words ----------
  var SIZES = { logo: [1400, 0, "Any logo works. A see-through PNG looks best."], hero: [2400, 1600, "Any wide image works. Bigger is sharper."], flyer: [1080, 1350, "Any size works. 1080×1350 looks best."],
    figure: [800, 0, "A see-through PNG looks best."], partners: [1200, 0, "White logos on a see-through background look best."], share: [1200, 630, "Wide image, 1200×630 looks best."], icon: [300, 300, "Any square image."], video: [0, 0, "MP4, under 30 seconds"] };
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
      app.innerHTML = top(homeHref()) + "<h1>Your brand</h1><p class=lead>Upload it once. Every show you run starts looking like you.</p>" +
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
        call("brand-save", { company: co.id, brand: b }).then(function (r) { co.brand = r.brand; say("Saved."); setTimeout(function () { go(homeHref()); }, 500); }).catch(function (x) { say(x.message, true); });
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
    var head = top(n > 1 ? "#show/" + id + "/" + (n - 1) : homeHref()) + stepHead(1, "Your show", n + " of 5");
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
    var s = showById(id); if (!s) return go(homeHref());
    var k = JSON.parse(JSON.stringify(s.kit || {})); k.flyers = k.flyers || []; k.figures = k.figures || [];
    var more = !!(k.hero || k.logo || k.video || k.links || k.figures.some(Boolean));
    var onward = function () { return company().paid_ready ? "#send/" + s.id : "#paid"; };
    function draw(warnFor, warn) {
      var md = document.getElementById("more"); if (md) more = md.open;
      var lk = document.getElementById("links"); if (lk) k.links = lk.value;
      app.innerHTML = top(homeHref()) + stepHead(2, "Your flyer") + "<h1>Drop in your flyer</h1><p class=lead>For <b>" + esc(s.name) + "</b>. Any size works. We build the page around it.</p>" +
        s.nights.map(function (n, i) { return drop("flyer" + i, s.nights.length > 1 ? n.label + " flyer" : "Your flyer", "flyer", k.flyers[i]); }).join("") +
        "<details id=more" + (more ? " open" : "") + "><summary>Got more art? Add it here (optional)</summary>" +
        drop("hero", "Background art", "hero", k.hero) +
        s.nights.map(function (n, i) { return drop("figure" + i, (s.nights.length > 1 ? n.label + " " : "") + "cutout or character", "figure", k.figures[i]); }).join("") +
        drop("logo", "A logo just for this show", "logo", k.logo) + drop("video", "Teaser video", "video", k.video) +
        '<label for=links>Or paste a link to your art</label><textarea id=links rows=3 placeholder="Google Drive or Dropbox link. We\'ll upload it for you.">' + esc(k.links || "") + "</textarea></details>" +
        '<button class=btn type=button id=save>Next</button><button class=linkbtn type=button id=skip>No flyer yet? Skip for now</button><p class=msg role=status></p>';
      wireTop();
      document.getElementById("skip").onclick = function () { go(onward()); };
      if (warnFor) { if (warn) warns[warnFor] = warn; else delete warns[warnFor]; }
      Object.keys(warns).forEach(function (k) { var w = document.querySelector("#d-" + k + " .st"); if (w && w.textContent.indexOf("Uploaded") >= 0) { w.textContent = "✓ Uploaded. " + warns[k]; w.className = "st warn"; } });
      app.querySelectorAll(".drop input").forEach(function (i) { i.onchange = function () { upload(i, { show: s.id }, function (key, url, warn) { set(key, url); draw(key, warn); }); }; });
      app.querySelectorAll("[data-clear]").forEach(function (x) { x.onclick = function (e) { e.stopPropagation(); set(x.getAttribute("data-clear"), null); draw(); }; });
      document.getElementById("save").onclick = function () {
        k.links = document.getElementById("links").value; say("Saving…");
        call("kit-save", { show: s.id, kit: k }).then(function (r) { s.kit = r.kit; return load(); }).then(function () { go(onward()); }).catch(function (x) { say(x.message, true); });
      };
    }
    function set(key, url) {
      var m = key.match(/^(flyer|figure)(\d)$/);
      if (m) { var arr = m[1] === "flyer" ? k.flyers : k.figures; while (arr.length <= +m[2]) arr.push(null); arr[+m[2]] = url; }
      else if (url) k[key] = url; else delete k[key];
    }
    draw();
  }

  // ---------- show music: what the music bar plays on this show's page ----------
  var PL = (C.supabaseUrl || "") + "/functions/v1/playlist";
  function music(id) {
    var s = showById(id); if (!s) return go(homeHref());
    var pl = null;
    function draw() {
      var own = pl.mode === "upload", full = pl.tracks.length >= (pl.max || 20);
      app.innerHTML = top(homeHref()) + "<h1>Show music</h1><p class=lead>What plays on the page for <b>" + esc(s.name) + "</b>. It always plays in a random order.</p>" +
        '<div class=choice><button type=button data-mode=subduction aria-pressed="' + !own + '">Subduction tracks</button><button type=button data-mode=upload aria-pressed="' + own + '">My own tracks</button></div>' +
        (own ? (pl.tracks.length ? "<p class=note>Every track needs a cover picture. It shows in the music bar while the track plays.</p>" : "") +
          pl.tracks.map(function (t, i) { return '<div class="card ptrack' + (t.art_path ? "" : " need") + '">' +
            '<div class="drop tcover" id=cv' + i + '><span class=thumb' + (t.art_url ? ' style="background-image:url(' + "'" + esc(t.art_url) + "'" + ')"' : "") + '></span><span><b>' + (t.art_path ? "Cover" : "Add a cover (required)") + '</b><small>JPG, PNG or WebP. Square works best.</small><small class=st>' + (t.art_path ? "Tap to change" : "Tap to add") + '</small><div class=bar2></div></span><input type=file accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" aria-label="Cover for track ' + (i + 1) + '" data-cv="' + i + '"></div>' +
            '<label for=tt' + i + '>Track ' + (i + 1) + ' title</label><input type=text id=tt' + i + ' maxlength=80 value="' + esc(t.title) + '"><label for=ta' + i + '>Artist</label><input type=text id=ta' + i + ' maxlength=80 value="' + esc(t.artist || "") + '"><button type=button class=linkbtn data-rm="' + i + '">Remove</button></div>'; }).join("") +
          (full ? "<p class=note>That's the most a show can have.</p>" : '<div class=drop id=d-track><span class=thumb></span><span><b>Add a track</b><small>MP3, WAV or M4A, up to 50 MB. You add its cover next.</small><small class=st>Tap to add</small><div class=bar2></div></span><input type=file accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" aria-label="Add a track"></div>') +
          "<p class=note>Only upload music and pictures you have the right to share.</p>"
          : "<p class=note>Your page plays a random mix of Subduction's tracks. Nothing to upload.</p>") +
        '<button class=btn type=button id=save>Save music</button><p class=msg role=status></p>' +
        "<h2>From your artists</h2>" + ((pl.artist_tracks || []).length ? pl.artist_tracks.map(function (t) { return "<div class=card><b>" + esc(t.title) + "</b><small>" + esc(t.artist || "") + (t.free_download ? " · free download on" : "") + '</small><button type=button class=linkbtn data-arm="' + esc(t.id) + '">Remove</button></div>'; }).join("")
          : "<p class=note>Artists with an artist pass can add their own tracks. They show up here and go straight into the mix.</p>");
      wireTop();
      app.querySelectorAll("[data-arm]").forEach(function (b) { b.onclick = function () { keep(); b.disabled = true; api(PL, { a: "artist-remove", show: s.id, id: b.getAttribute("data-arm") }).then(function (r) { pl.artist_tracks = r.artist_tracks; draw(); }).catch(function (x) { say(x.message, true); }); }; });
      app.querySelectorAll("[data-mode]").forEach(function (b) { b.onclick = function () { keep(); pl.mode = b.getAttribute("data-mode"); draw(); }; });
      app.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { keep(); pl.tracks.splice(+b.getAttribute("data-rm"), 1); draw(); }; });
      var inp = app.querySelector("#d-track input"); if (inp) inp.onchange = function () { add(inp); };
      app.querySelectorAll("[data-cv]").forEach(function (el) { el.onchange = function () { cover(el, +el.getAttribute("data-cv")); }; });
      document.getElementById("save").onclick = function () {
        keep();
        var missing = pl.mode === "upload" ? pl.tracks.filter(function (t) { return !t.art_path; }).length : 0;
        if (missing) { var first = app.querySelector(".ptrack.need"); if (first) first.scrollIntoView({ block: "center" }); return say(missing === 1 ? "One track still needs a cover picture." : missing + " tracks still need a cover picture.", true); }
        say("Saving…");
        api(PL, { a: "save", show: s.id, mode: pl.mode, tracks: pl.tracks }).then(function (r) { pl.mode = r.mode; pl.tracks = r.tracks; flash = "Music saved."; go(homeHref()); }).catch(function (x) { say(x.message, true); });
      };
    }
    function keep() { pl.tracks.forEach(function (t, i) { var a = document.getElementById("tt" + i), b = document.getElementById("ta" + i); if (a) t.title = a.value.trim(); if (b) t.artist = b.value.trim(); }); }
    function add(input) {
      var f = input.files[0]; if (!f) return;
      var box = input.closest(".drop"), st = box.querySelector(".st"), bar = box.querySelector(".bar2"), ext = (f.name.split(".").pop() || "").toLowerCase();
      if (["mp3", "wav", "m4a"].indexOf(ext) < 0) { st.textContent = "Use an MP3, WAV or M4A."; st.className = "st warn"; return; }
      if (f.size > 50 * 1048576) { st.textContent = "That track is over 50 MB. Export it as a 320 kbps MP3 and it will fit."; st.className = "st warn"; return; }
      st.textContent = "Uploading…"; st.className = "st"; keep();
      api(PL, { a: "upload-url", show: s.id, ext: ext }).then(function (r) {
        return new Promise(function (ok, no) {
          var x = new XMLHttpRequest(); x.open("PUT", r.upload_url, true); x.setRequestHeader("Content-Type", r.content_type);
          x.upload.onprogress = function (e) { if (e.lengthComputable) bar.style.width = Math.round(e.loaded / e.total * 100) + "%"; };
          x.onload = function () { x.status < 300 ? ok(r.path) : no(new Error("Upload failed. Try again.")); }; x.onerror = function () { no(new Error("Upload failed. Check your connection.")); };
          x.send(f);
        });
      }).then(function (path) { pl.tracks.push({ path: path, title: f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80), artist: "" }); draw();
          var last = app.querySelector("#cv" + (pl.tracks.length - 1)); if (last) last.scrollIntoView({ block: "center" }); say("Track added. Now add its cover picture."); })
        .catch(function (e) { st.textContent = e.message; st.className = "st warn"; });
    }
    // A cover for one of the promoter's own tracks: uploaded straight to storage, previewed right away.
    function cover(input, i) {
      var f = input.files[0]; if (!f) return;
      var box = input.closest(".drop"), st = box.querySelector(".st"), bar = box.querySelector(".bar2"), ext = (f.name.split(".").pop() || "").toLowerCase().replace("jpeg", "jpg");
      if (["jpg", "png", "webp"].indexOf(ext) < 0) { st.textContent = "Use a JPG, PNG or WebP."; st.className = "st warn"; return; }
      if (f.size > 10 * 1048576) { st.textContent = "That picture is over 10 MB. Try a smaller one."; st.className = "st warn"; return; }
      st.textContent = "Uploading…"; st.className = "st"; keep();
      api(PL, { a: "upload-url", show: s.id, ext: ext, kind: "art" }).then(function (r) {
        return new Promise(function (ok, no) {
          var x = new XMLHttpRequest(); x.open("PUT", r.upload_url, true); x.setRequestHeader("Content-Type", r.content_type);
          x.upload.onprogress = function (e) { if (e.lengthComputable) bar.style.width = Math.round(e.loaded / e.total * 100) + "%"; };
          x.onload = function () { x.status < 300 ? ok(r.path) : no(new Error("Upload failed. Try again.")); }; x.onerror = function () { no(new Error("Upload failed. Check your connection.")); };
          x.send(f);
        });
      }).then(function (path) { pl.tracks[i].art_path = path; try { pl.tracks[i].art_url = URL.createObjectURL(f); } catch (e) {} draw(); say(""); })
        .catch(function (e) { st.textContent = e.message; st.className = "st warn"; });
    }
    app.innerHTML = top(homeHref()) + "<h1>Show music</h1><p class=msg role=status>Loading…</p>"; wireTop();
    api(PL + "?a=get&show=" + s.id).then(function (r) { pl = r; draw(); }).catch(function (x) { say(x.message, true); });
  }

  // ---------- get paid ----------
  function paid() {
    var co = company();
    var fs = firstShow(), nextHref = fs ? "#send/" + fs.id : homeHref();
    app.innerHTML = top(homeHref()) + stepHead(3, "Get paid") + "<h1>Get paid</h1>" + (co.paid_ready ? "<p class=lead>&#10003; You're all set. Ticket money goes straight to your own account.</p><p class=note>" + StackSavings.stripeNote() + "</p>" + '<a class=btn href="' + nextHref + '">' + (fs ? "Next: send my show" : "Done") + "</a>"
      : "<p class=lead>Ticket money goes straight to your own bank. Stripe is the payment company that sends it. It takes about 5 minutes and you'll need your bank details.</p><p class=note>Subduction never holds your money.</p>" +
        (company().can_manage ? '<button class=btn type=button id=st>Connect my bank</button>' : "<p class=note>Only the crew's owner can do this step.</p>") +
        (fs ? '<a class=linkbtn href="' + nextHref + '">Do this later and send my show now</a>' : "")) + "<p class=msg role=status></p>";
    wireTop();
    // Just back from Stripe (or still waiting on it): ask Stripe where things stand.
    if (!co.paid_ready && co.can_manage) api(CONNECT + "?a=status&company=" + co.id).then(function (r) { if (r.charges_enabled) { co.paid_ready = true; paid(); } else if (r.connected) say("Stripe is still checking your details. This can take a few minutes."); }).catch(function () {});
    var b = document.getElementById("st");
    if (b) b.onclick = function () { say("Opening Stripe…"); api(CONNECT, { a: "start", company: co.id }).then(function (r) { location.href = r.url; })
      // A promoter never sees a raw message from the payment company. If bank setup isn't open on our side yet, say so plainly.
      .catch(function (x) { say(/platform profile|dashboard\.stripe|Connect|isn't open/i.test(x.message) ? "Bank setup isn't open just yet. That's on our side, not yours. We'll email you the moment it is. You can still send your show now." : x.message, true); }); };
  }

  // ---------- send to Subduction ----------
  // After a show is sent: what they sent, their link, where it stands, and what they can do while they wait.
  function doneScreen(s, co) {
    var money = function (c) { return "$" + (c / 100).toFixed(c % 100 ? 2 : 0); };
    var when = s.nights.map(function (n) { var d = n.starts_at ? new Date(n.starts_at) : null;
      return esc(n.label) + (d ? " · doors " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "") : ""); }).join("<br>");
    var where = s.secret ? "Secret location" + (s.city ? ", " + esc(s.city) : "") : [s.venue, s.city].filter(Boolean).map(esc).join(", ");
    var tix = s.tickets.map(function (t) { return t.tiers.map(function (r) { return esc(t.name) + (t.tiers.length > 1 ? " · " + esc(r.name) : "") + " · " + money(r.price_cents) + (r.qty ? " <span class=dim>(" + r.qty + ")</span>" : ""); }).join("<br>"); }).join("<br>");
    var link = "subduction.art/" + s.slug, kit = s.kit || {};
    var hasFlyer = !!((kit.flyers || []).some(Boolean) || kit.links), brandDone = !!(co.brand && (co.brand.logo || (co.brand.colors && co.brand.colors.accent)));
    var stage = s.live ? 4 : s.review_status === "approved" ? 3 : 2;
    var step = function (n, t, d) { return '<li class="' + (n < stage ? "done" : n === stage ? "next" : "") + '"><span class=n>' + (n < stage ? "&#10003;" : n) + "</span><span><b>" + t + "</b><small>" + d + "</small></span></li>"; };
    var extra = function (ok, t, d, href, cta) { return '<div class="card todo' + (ok ? " ok" : "") + '" data-href="' + href + '"><b>' + (ok ? "&#10003; " : "") + t + "</b><small>" + d + "</small>" + (ok ? "" : '<span class=go>' + cta + " &rarr;</span>") + "</div>"; };
    return "<div class=qnum>" + (s.live ? "Live" : "Sent") + "</div><h1>" + (s.live ? "You're live" : "We've got it") + "</h1><p class=lead>" +
      (s.live ? "<b>" + esc(s.name) + "</b> is up and selling. Share your link everywhere." : "<b>" + esc(s.name) + "</b> is with us. Nothing else you have to do right now. We'll email you the moment your page is ready to look over.") + "</p>" +
      '<div class=linkbox><small>Your link</small><b>' + link + '</b><button type=button class=ghostbtn id=copy>Copy link</button><small class=dim>' + (s.live ? "Your page is live at this link." : "It works once your page goes live. You can start telling people now.") + "</small></div>" +
      "<h2>Where it's at</h2><ol class=\"steps plain\">" + step(1, "Sent to us", "Got it, thanks.") + step(2, "We build your page", "Usually within a day.") +
        step(3, "You look it over", "We email you a preview. Tell us what to change.") + step(4, "It goes live", "Tickets go on sale at your link.") + "</ol>" +
      "<h2>What you sent</h2><div class=\"card summary\"><b>" + esc(s.name) + "</b>" +
        (when ? "<div><span class=lbl>When</span>" + when + "</div>" : "") + (where ? "<div><span class=lbl>Where</span>" + where + (s.age ? " · " + esc(s.age) : "") + "</div>" : "") +
        (tix ? "<div><span class=lbl>Tickets</span>" + tix + "</div>" : "") + "<div><span class=lbl>Flyer</span>" + (hasFlyer ? "Added" : "None yet. We'll start your page in our neon look.") + "</div>" +
        '<a class=linkbtn href="#show/' + s.id + '/1">Change something</a></div>' +
      "<h2>Make it yours <span class=dim>(optional)</span></h2>" +
        extra(co.paid_ready, "Get paid", co.paid_ready ? "Your bank is connected. Ticket money goes straight to you." : "Connect your bank. You need this before tickets go on sale.", "#paid", "Connect my bank") +
        extra(hasFlyer, "Your flyer", hasFlyer ? "Added." : "Drop it in so your page uses your art.", "#art/" + s.id, "Add my flyer") +
        extra(brandDone, "Your logo and colors", brandDone ? "Added. Every page of yours uses them." : "So your page looks like you, not like us.", "#brand", "Add them") +
        extra(false, "Your show music", "Play your own tracks on your page, or a mix of ours.", "#music/" + s.id, "Pick music") +
      '<p class=note>Questions? Email <a href="mailto:hello@subduction.art">hello@subduction.art</a>.</p>';
  }

  function send(id) {
    var s = showById(id); if (!s) return go(homeHref());
    var co = company(), hasFlyer = !!(s.kit && ((s.kit.flyers || []).some(Boolean) || s.kit.links));
    var line = function (ok, t, d, href) { return '<li class="' + (ok ? "done" : "") + '"' + (href ? ' data-href="' + href + '"' : "") + '><span class=n>' + (ok ? "&#10003;" : "!") + "</span><span><b>" + t + "</b><small>" + d + "</small></span></li>"; };
    app.innerHTML = top(homeHref()) + (s.checklist.submitted
      ? doneScreen(s, co)
      : "<div class=qnum>Last thing</div><h1>Ready to send?</h1><p class=lead>We build your page and email you when it's ready to look over.</p><ol class=steps>" +
        line(!!s.checklist.details, "Your show", esc(s.name), "#show/" + s.id + "/1") +
        line(hasFlyer, "Your flyer", hasFlyer ? "Added" : "None yet. Your page starts in our neon look.", "#art/" + s.id) +
        line(co.paid_ready, "Get paid", co.paid_ready ? "Bank connected" : "Not connected yet. You need this before tickets go on sale.", "#paid") + "</ol>" +
        '<button class=btn type=button id=go' + (s.checklist.details ? "" : " disabled") + ">Send my show</button>") + "<p class=msg role=status></p>";
    app.querySelectorAll("[data-href]").forEach(function (el) { el.onclick = function () { go(el.getAttribute("data-href")); }; });
    wireTop();
    var b = document.getElementById("go");
    var cp = document.getElementById("copy");
    if (cp) cp.onclick = function () { var t = "https://subduction.art/" + s.slug; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { cp.textContent = "Copied"; }, function () { cp.textContent = t; }); };
    if (b) b.onclick = function () { say("Sending…"); call("submit", { show: s.id }).then(function () { return load(); }).then(function () { send(id); }).catch(function (x) { say(x.message, true); }); };
  }

  function links(id) {
    var s = showById(id); if (!s) return go(homeHref());
    function money(cents) { return "$" + ((Number(cents) || 0) / 100).toFixed(2); }
    function paint(d) {
      if (!d || d.ready === false) {
        app.innerHTML = top(homeHref()) + "<h1>Street team</h1><p class=lead>" + esc(s.name) + "</p><p class=note>" + esc((d && d.error) || "Street team links are not ready yet.") + "</p>";
        wireTop(); return;
      }
      var rows = (d.rows || []).map(function (r) {
        var owed = r.owed_cents == null ? "No payout set" : "You owe " + money(r.owed_cents);
        return '<div class=card><b>' + esc(r.label) + (r.saved ? "" : " (not saved yet)") + '</b><span class=streetcode>' + esc(r.link) + "</span><small>" +
          r.tickets + " paid " + (r.tickets === 1 ? "ticket" : "tickets") + " · " + money(r.revenue_cents) + " in tickets · " + owed +
          '</small><button type=button class=ghost data-copy="' + esc(r.link) + '">Copy link</button></div>';
      }).join("");
      app.innerHTML = top(homeHref()) + "<h1>Street team</h1><p class=lead>" + esc(s.name) + "</p><p class=note>" + esc(d.line || "") + "</p>" + rows +
        "<h2>Add a link</h2>" +
        '<label for=sl-name>Name</label><input id=sl-name maxlength=60 placeholder="DJ Name">' +
        '<label for=sl-code>Code</label><input id=sl-code maxlength=32 placeholder="djname" autocapitalize=off spellcheck=false>' +
        '<label for=sl-pay>Payout per ticket, optional</label><input id=sl-pay inputmode=decimal placeholder="2.50">' +
        '<button class=btn type=button id=sl-save>Save link</button><p class=msg role=status></p>';
      wireTop();
      app.querySelectorAll("[data-copy]").forEach(function (b) {
        b.onclick = function () {
          var t = b.getAttribute("data-copy");
          (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { say("Copied."); }, function () { say(t); });
        };
      });
      document.getElementById("sl-save").onclick = function () {
        say("Saving…");
        call("street-save", { show: id, label: document.getElementById("sl-name").value, code: document.getElementById("sl-code").value, payout: document.getElementById("sl-pay").value.trim() })
          .then(function (r) { paint(r); say("Saved."); })
          .catch(function (x) { say(x.message, true); });
      };
    }
    app.innerHTML = top(homeHref()) + "<h1>Street team</h1><p class=lead>" + esc(s.name) + "</p><p class=msg role=status>Loading…</p>";
    wireTop();
    api(FN + "?a=street&show=" + encodeURIComponent(id)).then(paint).catch(function (x) {
      app.innerHTML = top(homeHref()) + "<h1>Street team</h1><p class=lead>" + esc(s.name) + '</p><p class="msg bad">' + esc(x.message) + "</p>";
      wireTop();
    });
  }

  function load() { return api(FN + "?a=me").then(function (r) { me = r; if (!coId || !me.companies.some(function (c) { return c.id === coId; })) coId = (me.companies[0] || {}).id || ""; }); }
  function route() {
    app.onclick = null; warns = {};
    if (!tok) return signin();
    if (!me) return load().then(route).catch(function (e) { if (tok) app.innerHTML = '<p class="msg bad">' + esc(e.message) + "</p>"; });
    var h = location.hash.replace(/^#/, "").split("/");
    window.scrollTo(0, 0);
    if (h[0] === "co" && h[1]) { coId = h[1]; return home(); }
    if (me.owner && !h[0]) return promoters();
    if (h[0] === "brand") return brand();
    if (h[0] === "show") return question(h[1] || "new", h[2]);
    if (h[0] === "art") return art(h[1]);
    if (h[0] === "music") return music(h[1]);
    if (h[0] === "paid") return paid();
    if (h[0] === "send") return send(h[1]);
    if (h[0] === "links") return links(h[1]);
    home();
  }
  window.addEventListener("hashchange", route);
  // Arriving from the invite email: trade the one-time link for a session, then open their checklist.
  var invite = (location.hash.match(/^#invite=([0-9a-f-]+\.[0-9a-f]+)$/) || [])[1];
  if (invite) {
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    app.innerHTML = "<p class=lead>Signing you in…</p>";
    call("redeem", { invite: invite }).then(function (r) { tok = r.token; try { localStorage.setItem(KEY, tok); } catch (e) {} me = null; route(); })
      .catch(function (x) { tok = ""; signin(); say(x.message, true); });
    return;
  }
  // Back from Stripe: refresh where things stand.
  if (/stripe=/.test(location.search)) { try { history.replaceState(null, "", location.pathname + "#paid"); } catch (e) {} }
  route();
})();
