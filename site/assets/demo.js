/* The demo funnel: a promoter gets a test ticket, sees the email, their own dashboard and the door scan, then signs up. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/demo";
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "sub_demo", lead = null, claimKey = "";
  var time = function (iso) { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };

  // The light-burst that stands in for a show's art.
  (function () {
    var L = "", i, x;
    for (i = 0; i <= 40; i++) { x = (i / 40 * 800).toFixed(0); L += '<line x1="400" y1="210" x2="' + x + '" y2="0" stroke="#00e5ff"/><line x1="400" y1="210" x2="' + x + '" y2="420" stroke="#ff2bd6"/>'; }
    $("burst").innerHTML = '<svg viewBox="0 0 800 420" aria-hidden="true" style="background:radial-gradient(ellipse at 50% 50%,#2a0a33,#050505 75%)"><g stroke-width="1" opacity=".75">' + L + "</g></svg>";
  })();

  // The bars up top are buttons: tap any step you've already reached to go back (or forward again).
  var reached = 1;
  function go(n) {
    reached = Math.max(reached, n);
    [1, 2, 3, 4, 5].forEach(function (i) { $("s" + i).hidden = i !== n; });
    Array.prototype.forEach.call($("steps").children, function (el, i) {
      el.className = i < n ? "on" : "";
      el.disabled = i + 1 > reached;
      if (i + 1 === n) el.setAttribute("aria-current", "step"); else el.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
  }
  $("steps").addEventListener("click", function (e) {
    var b = e.target.closest("[data-step]"); if (!b || b.disabled) return;
    go(parseInt(b.getAttribute("data-step"), 10));
  });
  function fill(l) {
    lead = l;
    try { localStorage.setItem(KEY, l.token); } catch (e) {}
    $("toEmail").textContent = l.email; $("mFrom").textContent = (l.crew || "Your crew") + " Tickets"; $("tkBy").textContent = l.crew || ""; $("tkName").textContent = l.name || ""; $("tkCode").textContent = l.code;
    $("qr").src = $("qr2").src = FN + "?a=qr&t=" + l.token;
    $("dName").textContent = l.name || ""; $("dEmail").textContent = l.email; $("dPhone").textContent = l.phone || ""; $("dCode").textContent = "GA · " + l.code;
    if (l.scanned_at) $("dIn").textContent = "1";
  }
  function post(body) {
    return fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong."); return j; }); });
  }

  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("name").value.trim(), crew = $("crew").value.trim(), email = $("email").value.trim(), phone = $("phone").value.trim();
    if (name.split(/\s+/).length < 2) { $("msg").textContent = "Add your full name (first and last)."; $("name").focus(); return; }
    if (!crew) { $("msg").textContent = "Add your crew or promoter name."; $("crew").focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { $("msg").textContent = "Check your email address."; $("email").focus(); return; }
    if (phone.replace(/\D/g, "").length < 10) { $("msg").textContent = "Add a phone number we can reach you at."; $("phone").focus(); return; }
    $("go").disabled = true; $("msg").textContent = "Making your ticket...";
    post({ a: "start", name: name, crew: crew, email: email, phone: phone, website: $("website").value })
      .then(function (l) {
        if (!l.token) { $("msg").textContent = "Thanks. Check your inbox."; return; }
        fill(l); $("msg").textContent = "";
        go(l.sent === false ? 3 : 2);   // if our email didn't go through, show the ticket right here instead
      })
      .catch(function (err) { $("msg").textContent = err.message; })
      .then(function () { $("go").disabled = false; });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".next"), function (b) { b.addEventListener("click", function () { go(Number(b.getAttribute("data-to"))); }); });

  $("scan").addEventListener("click", function () {
    if (!lead) return;
    $("scan").disabled = true;
    post({ a: "scan", t: lead.token }).then(function (r) {
      var d = $("door"), res = $("result");
      d.className = "screen door " + (r.again ? "dup" : "ok");
      res.hidden = false;
      res.innerHTML = r.again ? "<b>Already scanned</b><span></span><small></small>" : "<b>In</b><span></span><small></small>";
      res.querySelector("span").textContent = (r.name || "") + " · General Admission";
      res.querySelector("small").textContent = r.again ? "First scan was at " + time(r.scanned_at) + ". A screenshot can't get two people in." : "Checked in at " + time(r.scanned_at);
      $("dIn").textContent = "1"; lead.scanned_at = r.scanned_at;
      $("scan").textContent = "Scan it again";
      $("scan").className = "ghostbtn"; $("toSide").hidden = false;
    }).catch(function () {}).then(function () { $("scan").disabled = false; });
  });

  // The last button: open their promoter account. From the email link they're signed straight in;
  // otherwise the promoter page sends the usual 6-digit code to the email they gave.
  $("claim").addEventListener("click", function () {
    if (!lead) { location.href = "promoter.html"; return; }
    $("claim").disabled = true; $("cmsg").textContent = "Opening your account...";
    post({ a: "claim", t: lead.token, k: claimKey || undefined }).then(function (r) {
      try { if (r.session) localStorage.setItem("stack_admin", r.session); else sessionStorage.setItem("promo_email", r.email || lead.email); } catch (e) {}
      location.href = "promoter.html";
    }).catch(function (err) { $("cmsg").textContent = err.message; $("claim").disabled = false; });
  });

  // Coming back from the email link (or a refresh): pick up at the ticket.
  var t = (new URLSearchParams(location.search).get("t") || "").toLowerCase();
  claimKey = (new URLSearchParams(location.search).get("k") || "").replace(/[^0-9a-f]/gi, "").slice(0, 60);
  // Remember the one-tap key from the email on this phone, so coming back later still signs them straight in (no code to type).
  try { if (claimKey) localStorage.setItem(KEY + "_k", claimKey); else claimKey = localStorage.getItem(KEY + "_k") || ""; } catch (e) {}
  if (!/^[0-9a-f]{32}$/.test(t)) { try { t = localStorage.getItem(KEY) || ""; } catch (e) { t = ""; } }
  if (/^[0-9a-f]{32}$/.test(t)) {
    fetch(FN + "?t=" + t).then(function (r) { return r.ok ? r.json() : null; }).then(function (l) {
      if (!l) return;
      // From the email button: they've opened their ticket, so that's where they land. A plain refresh picks up where they were.
      fill(l); go(new URLSearchParams(location.search).get("t") ? 3 : l.scanned_at ? 5 : 2);
      try { history.replaceState(null, "", location.pathname); } catch (e) {}
    }).catch(function () {});
  }
})();
