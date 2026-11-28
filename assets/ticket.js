/* One ticket: the QR code for the door, and which nights it's been used. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/tickets";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var t = (new URLSearchParams(location.search).get("t") || "").toLowerCase();
  var TOFTU_ID = "63b511f3-d838-404f-9c2e-5d4b98fbf013";
  if (!/^[0-9a-f]{48}$/.test(t)) { $("msg").textContent = "This ticket link isn't complete. Open it again from your email."; return; }
  function isToftu(ev) { return !ev || ev.slug === "underground" || ev.id === TOFTU_ID; }
  function drawPromoter(d) {
    var k = d.ticket, ev = d.event;
    document.title = (k.type || "Ticket") + " · " + ev.name;
    document.body.classList.remove("toftu");
    document.body.classList.add("pro-ticket");
    document.querySelectorAll(".toftu").forEach(function (el) { el.classList.remove("toftu"); });
    var brand = document.querySelector(".brand");
    if (brand) brand.innerHTML = '<p class="byline">' + esc(d.by || "") + "</p>";
    var h1 = document.querySelector("h1");
    if (h1) { h1.className = "show-name"; h1.textContent = ev.name; }
    $("kind").textContent = k.artist ? "Artist pass" : k.comp ? "Guest list" : "Ticket";
    $("ewhere").innerHTML = (ev.address ? esc(ev.venue || "") + (ev.venue ? "<br>" : "") + '<a href="https://maps.google.com/?q=' + encodeURIComponent(ev.address) + '" target="_blank" rel="noopener">' + esc(ev.address) + "</a>" : esc([ev.venue, ev.city].filter(Boolean).join(" · "))) + (ev.age ? "<br>" + esc(ev.age) + " · bring ID" : "");
    $("ttype").textContent = k.type || "Ticket";
    $("tname").textContent = k.name || "";
    $("qr").src = (C.supabaseUrl || "") + "/functions/v1/checkout?a=qr&t=" + t;
    $("pdf").hidden = true;
    $("tcode").textContent = k.status === "valid" ? k.code : "VOID";
    if (k.status !== "valid") $("card").classList.add("void");
    $("rows").innerHTML = (d.nights || []).map(function (n) {
      return '<div class="row"><span>' + esc(n.label) + (n.starts_at ? " · doors " + time(n.starts_at) : "") + "</span>" +
        (n.used_at ? '<b class="used">In at ' + time(n.used_at) + "</b>" : "<b>Not used yet</b>") + "</div>";
    }).join("");
    $("msg").hidden = true; $("tk").hidden = false;
  }
  var time = function (iso) { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }); };
  function pull(url) {
    return fetch(url).then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || "Not found"); e.status = r.status; throw e; } return j; }); });
  }
  pull(FN + "?a=ticket&t=" + t).catch(function (e) {
    if (!e || e.status !== 404) throw e;
    return pull((C.supabaseUrl || "") + "/functions/v1/checkout?a=ticket&t=" + t);
  }).then(function (d) {
    if (!isToftu(d.event)) return drawPromoter(d);
    var k = d.ticket, ev = d.event;
    document.title = (k.type || "Ticket") + " · " + ev.name;
    $("kind").textContent = k.artist ? "Artist pass · All access" : k.comp ? "Guest list" : "Ticket";
    if (k.artist) { document.body.classList.add("artistpass"); $("card").classList.add("ta"); var wm = document.querySelector(".brand .wm"); if (wm) wm.src = "assets/toftu/wordmark-gold.webp"; }
    $("ename").textContent = ev.name;
    $("ewhere").innerHTML = (ev.address ? '<span class="loclabel">The secret location</span><b>' + esc(ev.venue || "") + '</b><br><a href="https://maps.google.com/?q=' + encodeURIComponent(ev.address) + '" target="_blank" rel="noopener">' + esc(ev.address) + "</a>" + (ev.secret_until ? '<br><span class="loclabel">Secret until ' + esc(ev.secret_until) + ". Don't share it.</span>" : "") : esc(ev.venue || "") + (ev.reveal ? '<br><span class="loclabel">Location drops ' + esc(ev.reveal) + "</span>" : "")) +
      (ev.age ? '<br><span class="agepill">' + esc(ev.age) + " · bring ID</span>" : "");
    $("ttype").textContent = k.type || "Ticket";
    $("tname").textContent = k.name || "";
    $("qr").src = FN + "?a=qr&t=" + t;
    $("pdf").href = FN + "?a=pdf&t=" + t;
    if (k.status !== "valid") $("pdf").hidden = true;
    $("tcode").textContent = k.code;
    if (k.status !== "valid") { $("card").classList.add("void"); $("tcode").textContent = "VOID"; }
    $("rows").innerHTML = d.nights.map(function (n) {
      return '<div class="row"><span>' + esc(n.label) + (n.starts_at ? " · doors " + time(n.starts_at) : "") + "</span>" +
        (n.used_at ? '<b class="used">In at ' + time(n.used_at) + "</b>" : "<b>Not used yet</b>") + "</div>";
    }).join("");
    // Night colors: look up where this ticket's nights sit in the show (first night orange, second violet).
    fetch(FN + "?e=" + encodeURIComponent(ev.slug)).then(function (r) { return r.json(); }).then(function (pub) {
      var idx = d.nights.map(function (n) { return (pub.nights || []).findIndex(function (x) { return x.label === n.label; }); }).filter(function (i) { return i >= 0; });
      if (!idx.length || k.artist) return;   // the artist pass stays all gold
      var card = $("card"), pass = idx.length > 1;
      card.classList.add(pass ? "tp" : idx[0] % 2 ? "t2" : "t1");
      $("ttype").insertAdjacentHTML("afterbegin", idx.map(function (i) { return '<img class="teye" src="assets/toftu/eye-' + (i % 2 ? "sat" : "fri") + '.webp" alt="">'; }).join(""));
    }).catch(function () {});
    $("msg").hidden = true; $("tk").hidden = false;
  }).catch(function () { $("msg").textContent = "Couldn't find that ticket. Open it again from your email."; });
})();
