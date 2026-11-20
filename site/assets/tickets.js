/* Event page: what's on, what's on sale, and checkout through Stripe without leaving the page. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/tickets";
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var slug = (q.get("e") || "underground").replace(/[^a-z0-9-]/gi, "").toLowerCase();
  var data = null, cart = {}, checkout = null;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var usd = function (c) { return "$" + (c / 100).toFixed(c % 100 ? 2 : 0); };
  var time = function (iso) { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(":00", ""); };

  // Promoter links: ?ref=name tracks who sent them; ?code=XYZ fills in a promo code.
  var ref = (q.get("ref") || "").slice(0, 80);
  try { if (ref) sessionStorage.setItem("tix_ref", ref); else ref = sessionStorage.getItem("tix_ref") || ""; } catch (e) {}
  if (q.get("code")) { $("bpromo").value = q.get("code").slice(0, 30); $("promoBox").open = true; }

  function load() {
    return fetch(FN + "?e=" + slug).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Not found"); return j; }); });
  }

  function render() {
    var ev = data.event;
    document.title = ev.name + " · Tickets";
    if (ev.poster_url) { $("poster").src = ev.poster_url; $("poster").hidden = false; }
    $("name").textContent = ev.name;
    var map = ev.address ? "https://maps.google.com/?q=" + encodeURIComponent(ev.address) : null;
    $("where").innerHTML = ev.location_secret
      ? "<b>Secret location</b> · " + esc(ev.city || "") + '<br><span class="fineprint" style="margin:0">The address comes with your tickets.</span>'
      : esc(ev.venue || "") + (ev.address ? '<br><a href="' + map + '" target="_blank" rel="noopener">' + esc(ev.address) + "</a>" : "");
    $("meta").innerHTML = ['<span class="pill">' + esc(ev.age || "Age TBA") + "</span>"]
      .concat(data.nights.map(function (n) { return '<span class="pill">' + esc(n.label) + "</span>"; })).join("");
    $("nights").innerHTML = data.nights.map(function (n, i) {
      var ch = i % 2 ? '<img class="char" src="assets/toftu/jumper.webp" alt="" width="520" height="796">' : '<img class="char" src="assets/toftu/energy-orange.webp" alt="" width="520" height="849">';
      return '<div class="nw"><div class="night' + (i % 2 ? " n2" : "") + '">' + ch + '<img class="eye" src="assets/toftu/eye-' + (i % 2 ? "sat" : "fri") + '.webp" alt="" width="240" height="240"><h3>' + esc(n.label) + "</h3>" +
        (n.starts_at ? '<div class="when">Doors ' + time(n.starts_at) + (n.ends_at ? " – " + time(n.ends_at) : "") + "</div>" : "") +
        "<ul>" + (n.lineup || []).map(function (a) { return "<li>" + esc(a.name) + (a.note ? "<small>" + esc(a.note) + "</small>" : "") + "</li>"; }).join("") + "</ul></div></div>";
    }).join("");
    renderTypes();
    $("loading").hidden = true; $("ev").hidden = false;
  }

  // Night one's eye is orange, night two's is violet; a pass shows both.
  function eyes(idx) {
    return '<span class="eyes">' + idx.map(function (i) { return '<img src="assets/toftu/eye-' + (i % 2 ? "sat" : "fri") + '.webp" alt="" width="240" height="240">'; }).join("") + "</span>";
  }
  function renderTypes() {
    var open = data.event.sales_open && data.stripe_key;
    $("types").innerHTML = data.types.map(function (t) {
      var n = cart[t.slug] || 0, tier = t.tier, max = Math.min(t.left, data.event.max_per_order);
      var line = !open ? "On sale soon" : t.sold_out ? "Sold out" :
        (t.tier_count > 1 ? esc(tier.name) + " · " + tier.left + " left at this price" + (t.next_tier ? " <s>then " + usd(t.next_tier.price_cents) + "</s>" : "") : t.left + " left");
      var low = open && tier && tier.left <= 10;
      var idx = t.night_ids.map(function (id) { return data.nights.findIndex(function (x) { return x.id === id; }); });
      var tone = idx.length > 1 ? " tp" : idx[0] % 2 ? " t2" : " t1";
      return '<div class="type' + tone + (n ? " on" : "") + (t.sold_out ? " out" : "") + '">' +
        "<div><h4>" + eyes(idx) + esc(t.name) + "</h4>" + (t.blurb ? '<div class="b">' + esc(t.blurb) + "</div>" : "") + "</div>" +
        '<div class="price">' + (tier ? usd(tier.price_cents) : "") + "</div>" +
        '<div class="tier' + (low ? " low" : "") + '">' + line + "</div>" +
        (open && !t.sold_out ? '<div class="qty" style="grid-column:2"><button type="button" data-s="' + t.slug + '" data-d="-1" aria-label="One less"' + (n ? "" : " disabled") + '>&minus;</button><b>' + n +
          '</b><button type="button" data-s="' + t.slug + '" data-d="1" aria-label="One more"' + (n >= max ? " disabled" : "") + ">+</button></div>" : "") +
        "</div>";
    }).join("");
    $("buy").hidden = !open;
    updateTotal();
  }

  // Estimate only: the server prices each ticket by its place in line, so a cart that
  // crosses into the next tier is shown with the exact split before paying.
  function updateTotal() {
    var total = 0, count = 0;
    data.types.forEach(function (t) {
      var n = cart[t.slug] || 0; if (!n || !t.tier) return;
      var atTier = Math.min(n, t.tier.left), rest = n - atTier;
      total += atTier * t.tier.price_cents + rest * (t.next_tier ? t.next_tier.price_cents : t.tier.price_cents);
      count += n;
    });
    // Card fee is added at checkout so the show keeps the full ticket price (Stripe: 2.9% + 30c).
    var fee = total > 0 ? Math.ceil((total + 30) / (1 - 0.029)) - total : 0;
    $("total").textContent = usd(total + fee);
    $("feeNote").textContent = fee ? "incl. " + usd(fee) + " card fee" : "";
    $("go").disabled = !count;
    $("go").textContent = count ? "Checkout · " + count + " ticket" + (count > 1 ? "s" : "") : "Pick tickets";
  }

  $("types").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-s]"); if (!b) return;
    var s = b.getAttribute("data-s"), all = 0;
    Object.keys(cart).forEach(function (k) { all += cart[k]; });
    var d = Number(b.getAttribute("data-d"));
    if (d > 0 && all >= data.event.max_per_order) { $("bmsg").textContent = "Max " + data.event.max_per_order + " tickets per order."; return; }
    cart[s] = Math.max(0, (cart[s] || 0) + d);
    $("bmsg").textContent = "";
    renderTypes();
  });

  function loadStripe() {
    if (window.Stripe) return Promise.resolve(window.Stripe);
    return new Promise(function (ok, no) {
      var s = document.createElement("script"); s.src = "https://js.stripe.com/v3/";
      s.onload = function () { ok(window.Stripe); }; s.onerror = function () { no(new Error("Couldn't load checkout. Check your connection.")); };
      document.head.appendChild(s);
    });
  }

  $("buy").addEventListener("submit", function (e) {
    e.preventDefault();
    var items = Object.keys(cart).filter(function (k) { return cart[k] > 0; }).map(function (k) { return { slug: k, qty: cart[k] }; });
    var name = $("bname").value.trim(), email = $("bemail").value.trim();
    if (!items.length) return;
    if (!name) { $("bmsg").textContent = "Add your name."; $("bname").focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { $("bmsg").textContent = "Check your email address."; $("bemail").focus(); return; }
    $("go").disabled = true; $("bmsg").textContent = "Holding your tickets...";
    Promise.all([
      fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: "checkout", e: slug, items: items, name: name, email: email, promo: $("bpromo").value.trim() || null, ref: ref || null }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong."); return j; }); }),
      loadStripe(),
    ]).then(function (res) {
      var secret = res[0].client_secret, stripe = window.Stripe(data.stripe_key);
      return stripe.initEmbeddedCheckout({ fetchClientSecret: function () { return Promise.resolve(secret); } });
    }).then(function (c) {
      checkout = c; $("buy").hidden = true; $("types").hidden = true; $("payWrap").hidden = false; $("bmsg").textContent = "";
      c.mount("#checkout"); $("payWrap").scrollIntoView({ behavior: "smooth" });
    }).catch(function (err) {
      $("bmsg").textContent = err.message; $("go").disabled = false;
      load().then(function (d) { data = d; renderTypes(); }).catch(function () {});
    });
  });

  // Going back releases nothing on our side straight away: the hold simply runs out in ~35 minutes.
  $("back").addEventListener("click", function () {
    if (checkout) { checkout.destroy(); checkout = null; }
    $("payWrap").hidden = true; $("types").hidden = false; $("buy").hidden = false; $("go").disabled = false;
    load().then(function (d) { data = d; renderTypes(); }).catch(function () {});
  });

  // Back from Stripe: wait for the payment to land, then show the tickets.
  function showDone(sid) {
    $("shop").hidden = true; $("done").hidden = false;
    $("done").innerHTML = '<div class="done"><h2>Almost...</h2><p class="lead">Confirming your payment.</p></div>';
    var tries = 0;
    (function poll() {
      fetch(FN + "?a=order&s=" + encodeURIComponent(sid)).then(function (r) { return r.json(); }).then(function (o) {
        if (o.status === "paid" && o.tickets && o.tickets.length) {
          $("done").innerHTML = '<div class="done"><h2>You\'re in.</h2><p class="lead">Tickets sent to ' + esc(o.email) + '. Save them now, or open them from the email at the door.</p>' +
            '<div class="tlinks">' + o.tickets.map(function (t) { return '<a href="ticket.html?t=' + t.token + '"><span>' + esc(t.type) + "</span><b>" + t.code + "</b></a>"; }).join("") + "</div></div>";
          try { history.replaceState(null, "", location.pathname + "?e=" + slug); } catch (e) {}
        } else if (++tries < 30) setTimeout(poll, 2000);
        else $("done").innerHTML = '<div class="done"><h2>Payment received?</h2><p class="lead">Your tickets are on their way by email. If nothing arrives in 10 minutes, reply to any of our emails or DM us and we\'ll sort it.</p></div>';
      }).catch(function () { if (++tries < 30) setTimeout(poll, 2000); });
    })();
  }

  load().then(function (d) {
    data = d; render();
    var sid = q.get("s"); if (sid && /^cs_/.test(sid)) showDone(sid);
  }).catch(function (e) { $("loading").textContent = e.message === "Not found" ? "That show isn't here." : "Couldn't load. Refresh to try again."; });
})();
