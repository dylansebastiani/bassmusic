/* One ticket for a promoter's show: the QR code for the door and which nights it's been used. Plain look, the promoter's name on top. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/checkout";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var t = (new URLSearchParams(location.search).get("t") || "").toLowerCase();
  if (!/^[0-9a-f]{48}$/.test(t)) { $("msg").textContent = "This ticket link isn't complete. Open it again from your email."; return; }
  var time = function (iso) { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }); };
  fetch(FN + "?a=ticket&t=" + t).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error); return j; }); }).then(function (d) {
    var k = d.ticket, ev = d.event;
    document.title = (k.type || "Ticket") + " · " + ev.name;
    $("by").textContent = d.by || "";
    $("ename").textContent = ev.name;
    var place = ev.address ? esc(ev.venue || "") + (ev.venue ? "<br>" : "") + '<a href="https://maps.google.com/?q=' + encodeURIComponent(ev.address) + '" target="_blank" rel="noopener">' + esc(ev.address) + "</a>"
      : ev.address_later ? "The address will be emailed to you before the show." : esc([ev.venue, ev.city].filter(Boolean).join(" · "));
    $("ewhere").innerHTML = place + (ev.age ? "<br>" + esc(ev.age) + " · bring ID" : "");
    $("kind").textContent = k.artist ? "Artist pass" : k.comp ? "Guest list" : "Ticket";
    $("ttype").textContent = k.type || "Ticket";
    $("tname").textContent = k.name || "";
    $("qr").src = FN + "?a=qr&t=" + t;
    $("tcode").textContent = k.status === "valid" ? k.code : "VOID";
    if (k.status !== "valid") $("card").classList.add("void");
    $("rows").innerHTML = d.nights.map(function (n) {
      return '<div class="row"><span>' + esc(n.label) + (n.starts_at ? " · doors " + time(n.starts_at) : "") + "</span>" + (n.used_at ? "<b>In at " + time(n.used_at) + "</b>" : "<b>Not used yet</b>") + "</div>";
    }).join("");
    $("msg").hidden = true; $("tk").hidden = false;
  }).catch(function () { $("msg").textContent = "Couldn't find that ticket. Open it again from your email."; });
})();
