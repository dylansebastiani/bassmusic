/* Show page: draws a show from its page description (theme + art + sections) and runs checkout.
   The description format is documented in docs/PAGE_SPEC.md; the server cleans it before it gets here.
   Show facts (dates, lineup, tiers, venue) always come from the show itself, never the description. */
(function () {
  var C = window.STACK || {}, BASE = (C.supabaseUrl || "") + "/functions/v1", FN = BASE + "/tickets";   // FN switches to the second lane for promoters on their own Stripe
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var slug = (window.__SHOW_SLUG || q.get("e") || "").replace(/[^a-z0-9-]/gi, "").toLowerCase();   // ?e=<slug> or subduction.art/<slug>
  var PREVIEW = q.get("preview") === "1";
  var data = null, cart = {}, checkout = null;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var usd = function (c) { return "$" + (c / 100).toFixed(c % 100 ? 2 : 0); };
  var time = function (iso) { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(":00", ""); };
  var staffToken = function () { try { return localStorage.getItem("stack_admin") || ""; } catch (e) { return ""; } };

  var ref = (q.get("ref") || "").slice(0, 80);
  try { if (ref) sessionStorage.setItem("tix_ref", ref); else ref = sessionStorage.getItem("tix_ref") || ""; } catch (e) {}
  var TEST = q.get("test") === "1";
  function vis(d) { if (d && d.types && !TEST) d.types = d.types.filter(function (t) { return t.slug !== "test"; }); return d; }

  function load() {
    var h = PREVIEW && staffToken() ? { "x-admin-token": staffToken() } : {};
    // The show itself is fetched like any visitor would (no staff header), so this works with any ticket backend.
    var get = function (fn) { return fetch(BASE + "/" + fn + "?e=" + slug).then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || "Not found"); e.status = r.status; throw e; } return vis(j); }); }); };
    // Promoters on their own Stripe are served by the second lane; everything else by the original one.
    // Only a clear "not on this lane" answer falls through, so a hiccup can never send a sale down the wrong lane.
    var show = get("checkout").catch(function (e) { if (e.status !== 404) throw e; return get("tickets"); });
    if (!PREVIEW || !staffToken()) return show;
    // Preview: the working draft (and the fee) come from the studio's own backend, so previews work
    // whichever version of the ticket backend is running.
    var draft = fetch((C.supabaseUrl || "") + "/functions/v1/page?a=get&e=" + slug, { headers: h })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return Promise.all([show, draft]).then(function (x) {
      var d = x[0], p = x[1];
      if (p && p.draft) { d.page = p.draft; d.preview = true; if (!d.fee && p.fee) d.fee = p.fee; }
      return d;
    });
  }

  // ---------- prices: every price shown is the all-in total (FTC fee rule), same formula as checkout ----------
  function fee() { return (data && data.fee) || { platform_cents: 0, card_pct: 0.029, card_fixed_cents: 30 }; }
  function allIn(c) { var f = fee(); return c > 0 ? Math.ceil((c + f.platform_cents + f.card_fixed_cents) / (1 - f.card_pct)) : 0; }

  // ---------- theme ----------
  var FONT_STACK = { "Bungee": '"Bungee","Anton",Impact,sans-serif', "Anton": '"Anton","Arial Narrow",Impact,sans-serif', "Archivo": '"Archivo",system-ui,sans-serif', "Space Mono": '"Space Mono",ui-monospace,Menlo,monospace' };
  function nightColor(i) { var n = data.page.theme.colors.nights; return n[i % n.length] || data.page.theme.colors.accent; }
  function applyTheme() {
    var t = data.page.theme, b = document.body, c = t.colors;
    var vars = { "--bg": c.bg, "--fg": c.text, "--mute": c.muted, "--line": c.line, "--hot": c.accent, "--disp": FONT_STACK[t.fonts.display], "--text": FONT_STACK[t.fonts.body],
      "--n1": nightColor(0), "--n2": nightColor(1) };
    Object.keys(vars).forEach(function (k) { b.style.setProperty(k, vars[k]); });
    b.className = "show f-" + t.frame + " t-" + t.titles + (t.glow ? " glow" : "") + (t.dots ? " dots" : "");
    document.querySelector('meta[name="theme-color"]').setAttribute("content", c.bg);
    // Custom styling for this show only. The server already removed anything that could load outside files
    // or escape the style tag; textContent means it's never parsed as HTML either.
    var st = $("customCss"); st.textContent = data.page.custom_css || "";
  }

  // ---------- sections ----------
  function img(src, cls, alt, extra) { return src ? '<img class="' + cls + '" src="' + esc(src) + '" alt="' + esc(alt || "") + '"' + (extra || "") + ">" : ""; }
  function nightArt(i) { var a = (data.page.art.nights || [])[i] || {}; return a; }
  function hasLineup() { return data.nights.some(function (n) { return (n.lineup || []).length; }); }

  var R = {
    brand: function (s) {
      var ev = data.event, a = data.page.art;
      var top = s.variant === "wordmark" && a.wordmark ? img(a.wordmark, "wm", ev.name, ' width="1400" height="373"') : '<div class="name">' + esc(ev.name) + "</div>";
      var sub = a.subtitle ? '<div class="sub-img">' + img(a.subtitle, "", "") + "</div>" : s.subtitle_text ? '<div class="sub">' + esc(s.subtitle_text) + "</div>" : "";
      return '<header class="s-brand">' + top + '<h1 class="sr">' + esc(ev.name) + "</h1>" + sub + "</header>";
    },
    hero: function (s) {
      var a = data.page.art; if (!a.hero) return data.page.plain ? '<div class="s-hero">' + burst() + "</div>" : "";
      var set = a.hero_small ? ' srcset="' + esc(a.hero_small) + " 720w, " + esc(a.hero) + ' 1200w" sizes="(max-width:760px) 100vw, 760px"' : "";
      return '<div class="s-hero v-' + s.variant + '"><img src="' + esc(a.hero) + '"' + set + ' alt="" fetchpriority="high"></div>';
    },
    dates: function (s) {
      var ev = data.event;
      var dates = data.nights.map(function (n, i) { return '<span class="d" style="--nc:' + nightColor(i) + '">' + esc(n.label) + "</span>"; }).join(' <span class="plus">+</span> ');
      var place = ev.location_secret ? "Secret location · " + esc(ev.city || "") : esc(ev.venue || "") + (ev.city ? (ev.venue ? " · " : "") + esc(ev.city) : "");
      var map = ev.address ? "https://maps.google.com/?q=" + encodeURIComponent(ev.address) : "";
      var addr = s.note ? esc(s.note) : ev.location_secret ? "The address comes with your tickets." : ev.address ? '<a href="' + map + '" target="_blank" rel="noopener">' + esc(ev.address) + "</a>" : "";
      return '<div class="s-dates v-' + s.variant + '"><div class="dates">' + dates + '</div><div class="infoline">' + place + (ev.age ? " · " + esc(ev.age) : "") + "</div>" + (addr ? '<div class="addr">' + addr + "</div>" : "") + "</div>";
    },
    flyers: function (s) {
      if (s.show === "after_lineup" && !hasLineup()) return "";
      var fl = data.page.art.flyers || [];
      var list = data.nights.map(function (n, i) { return { src: n.flyer_url || fl[i], label: n.label, i: i }; }).filter(function (x) { return x.src; });
      if (!list.length) return "";
      return '<div class="s-flyers v-' + s.variant + '">' + list.map(function (x) {
        return '<a href="' + esc(x.src) + '" target="_blank" rel="noopener" style="--nc:' + nightColor(x.i) + '"><img src="' + esc(x.src) + '" alt="' + esc(x.label) + ' flyer" loading="lazy"></a>';
      }).join("") + "</div>";
    },
    nights: function (s) {
      return '<div class="s-nights v-' + s.variant + '">' + data.nights.map(function (n, i) {
        var a = nightArt(i);
        return '<div class="night card" style="--nc:' + nightColor(i) + '">' + img(a.figure, "fig", "", ' loading="lazy" decoding="async"') + img(a.icon, "icon", "", ' loading="lazy" decoding="async"') +
          "<h3>" + esc(n.label) + "</h3>" + (n.starts_at ? '<div class="when">Doors ' + time(n.starts_at) + (n.ends_at ? " – " + time(n.ends_at) : "") + "</div>" : "") +
          ((n.lineup || []).length ? "<ul>" + n.lineup.map(function (x) { return "<li>" + esc(x.name) + (x.note ? "<small>" + esc(x.note) + "</small>" : "") + "</li>"; }).join("") + "</ul>"
            : '<p class="soon">' + esc(s.soon_text) + "</p>") + "</div>";
      }).join("") + "</div>";
    },
    tickets: function (s) {
      var fine = s.fineprint || ((data.event.age ? esc(data.event.age) + " with ID. " : "") + "Prices shown are the total you pay, fees included. Tickets are emailed right away with a QR code for the door. All sales final unless the show is cancelled.");
      return '<div id="done" hidden></div><section class="s-tickets" id="shop"><h2 class="sec">' + esc(s.title) + '</h2><p class="msg" id="loading" role="status" hidden>Loading tickets...</p><div class="types" id="types"></div>' +
        '<form class="buy" id="buy" novalidate><div class="total"><span class="mono">Total <small id="feeNote" style="text-transform:none;letter-spacing:0"></small></span><b id="total">$0</b></div>' +
        '<label for="bname">Full name</label><input type="text" id="bname" autocomplete="name" maxlength="80" required>' +
        '<label for="bemail">Email (your tickets go here)</label><input type="email" id="bemail" autocomplete="email" inputmode="email" maxlength="254" required aria-describedby="hemail" autocapitalize="off" spellcheck="false"><small class="hint" id="hemail" aria-live="polite"></small>' +
        '<label for="bphone">Phone</label><input type="tel" id="bphone" autocomplete="tel" inputmode="tel" maxlength="20" required aria-describedby="hphone" placeholder="(309) 555-0123"><small class="hint" id="hphone" aria-live="polite"></small>' +
        '<details class="promo" id="promoBox"><summary>Have a code?</summary><label for="bpromo">Code</label><input type="text" id="bpromo" autocomplete="off" maxlength="30"></details>' +
        '<button type="submit" class="btn" id="go">Checkout</button><p class="msg" id="bmsg" role="status"></p>' +
        '<p class="fineprint">' + (s.fineprint ? esc(s.fineprint) : fine) + ' Your ticket also makes you a Subduction member: unreleased tracks and first word on shows by email. Unsubscribe anytime. <a href="privacy.html">Privacy</a>.</p></form>' +
        '<div id="payWrap" hidden><button type="button" class="back" id="back">&larr; Change tickets</button><div id="checkout"></div></div></section>';
    },
    partners: function () { var a = data.page.art; return a.partners ? img(a.partners, "s-partners", "Event partners", ' decoding="async"') : ""; },
    text: function (s) { return s.title || s.body ? '<div class="s-text v-' + s.variant + (s.variant === "boxed" ? " card" : "") + '">' + (s.title ? "<h2>" + esc(s.title) + "</h2>" : "") + (s.body ? "<p>" + esc(s.body) + "</p>" : "") + "</div>" : ""; },
    video: function () { var v = data.page.art.video; return v ? '<div class="s-video"><video src="' + esc(v) + '" muted loop playsinline autoplay preload="metadata"></video></div>' : ""; },
    faq: function (s) { return (s.items || []).length ? '<div class="s-faq">' + s.items.map(function (x) { return "<details><summary>" + esc(x.q) + "</summary><p>" + esc(x.a) + "</p></details>"; }).join("") + "</div>" : ""; },
  };

  function render() {
    var ev = data.event, p = data.page;
    document.title = (p.meta.title || ev.name) + " · Tickets";
    applyTheme();
    $("preview").hidden = !data.preview;
    $("page").innerHTML = p.sections.map(function (s) { return (R[s.type] || function () { return ""; })(s); }).join("");
    wireCheckout();
    renderTypes();
  }

  // ---------- tickets + checkout ----------
  function icons(idx) { return '<span class="icons">' + idx.map(function (i) { var a = nightArt(i); return a.icon ? img(a.icon, "", "", ' loading="lazy" decoding="async"') : ""; }).join("") + "</span>"; }
  function renderTypes() {
    var open = data.event.sales_open && data.stripe_key, f = fee();
    if (open && !data.preview) warmStripe();
    if (!data.types.length) { $("types").innerHTML = '<p class="msg" style="text-align:center">Tickets go on sale soon.</p>'; $("buy").hidden = true; return; }
    $("types").innerHTML = data.types.map(function (t) {
      var n = cart[t.slug] || 0, tier = t.tier, max = Math.min(t.left, data.event.max_per_order);
      var line = !open ? "On sale soon" : t.sold_out ? "Sold out" :
        (t.tier_count > 1 ? esc(tier.name) + " · " + tier.left + " left at this price" + (t.next_tier ? " <s>then " + usd(allIn(t.next_tier.price_cents)) + "</s>" : "") : t.left + " left");
      var low = open && tier && tier.left <= 10;
      var idx = t.night_ids.map(function (id) { return data.nights.findIndex(function (x) { return x.id === id; }); }).filter(function (i) { return i >= 0; });
      var style = "--tc:" + nightColor(idx[0] || 0) + ";--tc2:" + nightColor(idx[1] != null ? idx[1] : idx[0] || 0);
      return '<div class="type card' + (idx.length > 1 ? " pass" : "") + (n ? " on" : "") + (t.sold_out ? " out" : "") + '" style="' + style + '">' +
        "<div><h4>" + icons(idx) + esc(t.name) + "</h4>" + (t.blurb ? '<div class="b">' + esc(t.blurb) + "</div>" : "") + "</div>" +
        '<div class="price">' + (tier ? usd(allIn(tier.price_cents)) + "<small>fees incl.</small>" : "") + "</div>" +
        '<div class="tier' + (low ? " low" : "") + '">' + line + "</div>" +
        (open && !t.sold_out ? '<div class="qty"><button type="button" data-s="' + esc(t.slug) + '" data-d="-1" aria-label="One less"' + (n ? "" : " disabled") + ">&minus;</button><b>" + n +
          '</b><button type="button" data-s="' + esc(t.slug) + '" data-d="1" aria-label="One more"' + (n >= max ? " disabled" : "") + ">+</button></div>" : "") + "</div>";
    }).join("");
    $("buy").hidden = !open;
    updateTotal();
  }
  function updateTotal() {
    var total = 0, fees = 0, count = 0;
    data.types.forEach(function (t) {
      var n = cart[t.slug] || 0; if (!n || !t.tier) return;
      var atTier = Math.min(n, t.tier.left), rest = n - atTier, next = t.next_tier ? t.next_tier.price_cents : t.tier.price_cents;
      total += atTier * t.tier.price_cents + rest * next;
      fees += atTier * (allIn(t.tier.price_cents) - t.tier.price_cents) + rest * (allIn(next) - next);
      count += n;
    });
    $("total").textContent = usd(total + fees);
    $("feeNote").textContent = fees ? "All-in. Includes " + usd(fees) + (fee().platform_cents ? " in fees" : " card processing fee") : "";
    $("go").disabled = !count;
    $("go").textContent = count ? "Checkout · " + count + " ticket" + (count > 1 ? "s" : "") : "Pick tickets";
  }

  var EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
  var FIX = { "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmal.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
    "yaho.com": "yahoo.com", "yahoo.co": "yahoo.com", "yahoo.con": "yahoo.com", "hotmial.com": "hotmail.com", "hotmail.co": "hotmail.com", "hotmail.con": "hotmail.com",
    "icloud.co": "icloud.com", "icloud.con": "icloud.com", "iclod.com": "icloud.com", "outlok.com": "outlook.com", "outlook.co": "outlook.com", "outlook.con": "outlook.com" };
  function phoneDigits(v) { return String(v || "").replace(/\D/g, ""); }
  function phoneOk(v) { var d = phoneDigits(v); return d.length === 10 || (d.length === 11 && d[0] === "1") || (/^\s*\+/.test(v) && d.length >= 11 && d.length <= 15); }
  function hint(input, el, cls, html) { input.classList.toggle("ok", cls === "ok"); input.classList.toggle("bad", cls === "bad"); el.className = "hint " + (cls || ""); el.innerHTML = html || ""; }
  function checkEmail(final) {
    var i = $("bemail"), h = $("hemail"), v = i.value.trim(); if (!v) { hint(i, h, "", ""); return false; }
    var dom = v.split("@")[1] || "", fix = FIX[dom.toLowerCase()];
    if (fix) { hint(i, h, "bad", 'Did you mean <button type="button" class="fixit">' + esc(v.split("@")[0] + "@" + fix) + "</button>?"); return false; }
    if (EMAIL_OK.test(v)) { hint(i, h, "ok", "&#10003; Looks good"); return true; }
    hint(i, h, final ? "bad" : "", final ? "That email doesn't look complete." : ""); return false;
  }
  function checkPhone(final) {
    var i = $("bphone"), h = $("hphone"), v = i.value; if (!v.trim()) { hint(i, h, "", ""); return false; }
    if (phoneOk(v)) { hint(i, h, "ok", "&#10003; Looks good"); return true; }
    hint(i, h, final ? "bad" : "", final ? "Enter a 10-digit phone number." : ""); return false;
  }
  // Stripe's script loads once, and early: as soon as a show is on sale we start fetching it in the background,
  // so tapping Buy only waits on the ticket hold, not on Stripe's code too.
  var stripeP = null;
  function loadStripe() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (stripeP) return stripeP;
    stripeP = new Promise(function (ok, no) {
      var s = document.createElement("script"); s.src = "https://js.stripe.com/v3/";
      s.onload = function () { ok(window.Stripe); };
      s.onerror = function () { stripeP = null; no(new Error("Couldn't load checkout. Check your connection.")); };
      document.head.appendChild(s);
    });
    return stripeP;
  }
  function warmStripe() {
    if (window.Stripe || stripeP) return;
    var go = function () { loadStripe().catch(function () {}); };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 1200);
  }
  // The tickets section is redrawn on every render (the studio re-renders live), so its handlers are attached each time.
  function wireCheckout() {
    if (q.get("code")) { $("bpromo").value = q.get("code").slice(0, 30); $("promoBox").open = true; }
    $("bphone").addEventListener("input", function () {
      var i = this, v = i.value;
      if (!/^\s*\+/.test(v)) {
        var d = phoneDigits(v); if (d.length === 11 && d[0] === "1") d = d.slice(1); d = d.slice(0, 10);
        var f = d.length > 6 ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : d.length > 3 ? "(" + d.slice(0, 3) + ") " + d.slice(3) : d;
        if (f !== v) i.value = f;
      }
      checkPhone(false);
    });
    $("bphone").addEventListener("blur", function () { checkPhone(true); });
    $("bemail").addEventListener("input", function () { checkEmail(false); });
    $("bemail").addEventListener("blur", function () { checkEmail(true); });
    $("hemail").addEventListener("click", function (e) { if (e.target.classList.contains("fixit")) { $("bemail").value = e.target.textContent; checkEmail(true); $("bphone").focus(); } });
    $("types").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-s]"); if (!b) return;
      var s = b.getAttribute("data-s"), all = 0; Object.keys(cart).forEach(function (k) { all += cart[k]; });
      var d = Number(b.getAttribute("data-d"));
      if (d > 0 && all >= data.event.max_per_order) { $("bmsg").textContent = "Max " + data.event.max_per_order + " tickets per order."; return; }
      cart[s] = Math.max(0, (cart[s] || 0) + d); $("bmsg").textContent = ""; renderTypes();
    });
    $("buy").addEventListener("submit", function (e) {
      e.preventDefault();
      if (data.preview) { $("bmsg").textContent = "This is a draft preview. Checkout works on the published page."; return; }
      var items = Object.keys(cart).filter(function (k) { return cart[k] > 0; }).map(function (k) { return { slug: k, qty: cart[k] }; });
      var name = $("bname").value.trim(), email = $("bemail").value.trim(), phone = $("bphone").value.trim();
      if (!items.length) return;
      if (name.split(/\s+/).length < 2) { $("bmsg").textContent = "Add your full name (first and last)."; $("bname").focus(); return; }
      if (!checkEmail(true)) { $("bmsg").textContent = "Check your email address."; $("bemail").focus(); return; }
      if (!checkPhone(true)) { $("bmsg").textContent = "Add a phone number we can reach you at."; $("bphone").focus(); return; }
      $("go").disabled = true; $("bmsg").textContent = "Holding your tickets...";
      Promise.all([
        fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ a: "checkout", e: slug, items: items, name: name, email: email, phone: phone, promo: $("bpromo").value.trim() || null, ref: ref || null, page: "show" }) })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong."); if (!j.free) $("bmsg").textContent = "Tickets held. Opening secure checkout..."; return j; }); }),
        loadStripe(),
      ]).then(function (res) {
        if (res[0].free) { $("shop").hidden = true; $("done").hidden = false; $("done").innerHTML = '<div class="done card"><h2>You\'re in.</h2><p class="lead">Your tickets are on their way to ' + esc(email) + ".</p></div>"; return null; }
        var acct = res[0].stripe_account || data.stripe_account;
        var secret = res[0].client_secret, stripe = acct ? window.Stripe(data.stripe_key, { stripeAccount: acct }) : window.Stripe(data.stripe_key);
        return stripe.initEmbeddedCheckout({ fetchClientSecret: function () { return Promise.resolve(secret); } });
      }).then(function (c) {
        if (!c) return;
        checkout = c; $("buy").hidden = true; $("types").hidden = true; $("payWrap").hidden = false; $("bmsg").textContent = "";
        c.mount("#checkout"); $("payWrap").scrollIntoView({ behavior: "smooth" });
      }).catch(function (err) {
        $("bmsg").textContent = err.message; $("go").disabled = false;
        load().then(function (d) { data = d; renderTypes(); }).catch(function () {});
      });
    });
    $("back").addEventListener("click", function () {
      if (checkout) { checkout.destroy(); checkout = null; }
      $("payWrap").hidden = true; $("types").hidden = false; $("buy").hidden = false; $("go").disabled = false;
      load().then(function (d) { data = d; renderTypes(); }).catch(function () {});
    });
  }

  function showDone(sid) {
    $("shop").hidden = true; $("done").hidden = false;
    $("done").innerHTML = '<div class="done card"><h2>Almost...</h2><p class="lead">Confirming your payment.</p></div>';
    var tries = 0;
    (function poll() {
      fetch(FN + "?a=order&s=" + encodeURIComponent(sid)).then(function (r) { return r.json(); }).then(function (o) {
        if (o.status === "paid" && o.tickets && o.tickets.length) {
          $("done").innerHTML = '<div class="done card"><h2>You\'re in.</h2><p class="lead">Tickets sent to ' + esc(o.email) + '. Save them now, or open them from the email at the door.</p>' +
            '<div class="tlinks">' + o.tickets.map(function (t) { return '<a href="' + (o.lane === 2 ? "pass" : "ticket") + '.html?t=' + esc(t.token) + '"><span>' + esc(t.type) + "</span><b>" + esc(t.code) + "</b></a>"; }).join("") + "</div></div>";
          try { history.replaceState(null, "", location.pathname + "?e=" + slug); } catch (e) {}
        } else if (++tries < 30) setTimeout(poll, 2000);
        else $("done").innerHTML = '<div class="done card"><h2>Payment received?</h2><p class="lead">Your tickets are on their way by email. If nothing arrives in 10 minutes, reply to any of our emails and we\'ll sort it.</p></div>';
      }).catch(function () { if (++tries < 30) setTimeout(poll, 2000); });
    })();
  }

  // The studio shows this page in a frame and sends edited drafts here, so changes appear as you make them.
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !data || !e.data || e.data.type !== "subduction:page" || !e.data.page) return;
    data.page = e.data.page; data.preview = true; render();
  });

  // The starting look, used until a show publishes its own design: neon on black with a drawn light-burst
  // where the show's art will go. No one else's art or colours.
  function plainPage(d) {
    var poster = d.event && d.event.poster_url;
    return { v: 1, plain: true, art: poster ? { hero: poster } : {}, custom_css: "", meta: {},
      theme: { colors: { bg: "#050505", text: "#f3effa", muted: "#a9a3bd", line: "#1f2a44", accent: "#00e5ff", nights: ["#00e5ff", "#ff2bd6"] },
        fonts: { display: "Bungee", body: "Archivo" }, frame: "angled", titles: "outline", glow: true, dots: false },
      sections: [{ type: "brand", variant: "text", subtitle_text: "" }, { type: "hero", variant: "fade" }, { type: "dates", variant: "flyer", note: "" },
        { type: "nights", variant: "cards", soon_text: "Lineup coming soon" }, { type: "tickets", variant: "cards", title: "Tickets", fineprint: "" }] };
  }
  function burst() {
    var L = "", i, x;
    for (i = 0; i <= 44; i++) { x = (i / 44 * 800).toFixed(0); L += '<line x1="400" y1="250" x2="' + x + '" y2="0" stroke="var(--n1)"/><line x1="400" y1="250" x2="' + x + '" y2="500" stroke="var(--n2)"/>'; }
    return '<svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="display:block;width:100%;height:auto;background:radial-gradient(ellipse at 50% 50%,color-mix(in srgb,var(--n2) 22%,var(--bg)),var(--bg) 75%);-webkit-mask-image:linear-gradient(transparent,#000 14%,#000 80%,transparent);mask-image:linear-gradient(transparent,#000 14%,#000 80%,transparent)"><g stroke-width="1" opacity=".75">' + L + "</g></svg>";
  }

  if (!slug) { $("page").innerHTML = '<p class="msg">No show picked.</p>'; return; }
  (window.__tix ? window.__tix.then(vis) : load()).then(function (d) {
    data = d; if (d.lane === 2) FN = BASE + "/checkout";
    // The first show keeps its own original tickets page, exactly as before.
    if (!d.page && !PREVIEW && slug === "underground") { location.replace("tickets.html?e=" + encodeURIComponent(slug)); return; }
    // A brand-new show in the studio: wait for the studio to send its first draft.
    if (!d.page && PREVIEW) { $("page").innerHTML = '<p class="msg">Waiting for the studio…</p>'; return; }
    var go = function () { render(); var sid = q.get("s"); if (sid && /^cs_/.test(sid)) showDone(sid); };
    if (d.page) return go();
    // Every other show: its published design if it has one, otherwise a plain page with no one else's look on it.
    return fetch((C.supabaseUrl || "") + "/functions/v1/shows?e=" + slug).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
      .then(function (x) { d.page = (x && x.page && x.page.theme && x.page.sections) ? x.page : plainPage(d); go(); });
  }).catch(function (e) { $("page").innerHTML = '<p class="msg">' + (e.message === "Not found" ? "That show isn't here." : "Couldn't load. Refresh to try again.") + "</p>"; });
})();
