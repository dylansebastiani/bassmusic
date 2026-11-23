/* An artist's private page: claim the gold Artist Pass, then run their own guest list. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/artist";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var k = (new URLSearchParams(location.search).get("k") || "").toLowerCase();
  var S = null, gtype = null;
  if (!/^[0-9a-f]{48}$/.test(k)) { $("msg").textContent = "This link isn't complete. Open it again from the text or email you got."; return; }

  function call(a, body) {
    var o = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ a: a, k: k }, body)) } : {};
    return fetch(FN + (body ? "" : "?a=" + a + "&k=" + k), o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong. Try again."); return j; });
    });
  }
  var day = function (iso) { return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" }); };
  var time = function (iso) { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).replace(":00", ""); };

  // ---- checks, same as checkout ----
  var FIX = { "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com", "hotmial.com": "hotmail.com", "iclod.com": "icloud.com", "icloud.con": "icloud.com", "outlok.com": "outlook.com" };
  function checkEmail(inp, hint) {
    var v = inp.value.trim().toLowerCase(), dom = v.split("@")[1] || "";
    hint.className = "hint"; hint.textContent = "";
    if (!v) return false;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) { hint.textContent = "That email doesn't look complete."; hint.className = "hint bad"; return false; }
    if (FIX[dom]) { var fixed = v.split("@")[0] + "@" + FIX[dom]; hint.innerHTML = 'Did you mean <button type="button" class="fixbtn">' + esc(fixed) + "</button>?"; hint.querySelector("button").onclick = function () { inp.value = fixed; checkEmail(inp, hint); }; }
    return true;
  }
  function checkPhone(inp, hint) {
    var d = inp.value.replace(/\D/g, "");
    if (d.length === 10) inp.value = "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
    var ok = d.length === 10 || (d.length === 11 && d[0] === "1") || (d.length >= 11 && d.length <= 15);
    hint.textContent = d && !ok ? "Enter a 10-digit phone number." : ""; hint.className = "hint bad";
    return ok;
  }
  function fullName(v) { v = v.trim().replace(/\s+/g, " "); return v.split(" ").length >= 2 ? v : null; }
  [["cemail", "cemailh"], ["gemail", "gemailh"]].forEach(function (p) { $(p[0]).addEventListener("blur", function () { checkEmail($(p[0]), $(p[1])); }); });
  [["cphone", "cphoneh"], ["gphone", "gphoneh"]].forEach(function (p) { $(p[0]).addEventListener("blur", function () { checkPhone($(p[0]), $(p[1])); }); });

  // ---- draw ----
  function draw(d) {
    S = d;
    document.title = "Artist pass · " + d.event.name;
    $("msg").hidden = true; $("view").hidden = false;
    $("aname").textContent = d.artist.name;
    $("adates").textContent = d.event.nights.map(function (n) { return day(n.starts_at); }).join(" + ") + (d.event.city ? " · " + d.event.city : "") + (d.event.age ? " · " + d.event.age : "");
    $("claim").hidden = d.artist.claimed; $("dash").hidden = !d.artist.claimed;
    if (!d.artist.claimed) { if (!$("cname").value) $("cname").value = d.artist.name; return; }
    $("passline").innerHTML = "Sent to <b>" + esc(d.artist.email || "") + "</b>. Good both nights" + (d.event.nights[0] ? ", doors " + time(d.event.nights[0].starts_at) : "") + ". Show the QR at the door.";
    if (d.pass) $("openpass").href = d.pass.url;
    var left = Math.max(0, d.artist.spots - d.artist.used);
    $("spots").textContent = d.artist.used + " of " + d.artist.spots + " spots";
    $("meter").style.width = (d.artist.spots ? Math.min(100, 100 * d.artist.used / d.artist.spots) : 100) + "%";
    $("full").hidden = left > 0; $("gf").hidden = left <= 0;
    var open = d.types.filter(function (t) { return t.open; });
    if (!open.some(function (t) { return t.slug === gtype; })) gtype = open.length ? open[0].slug : null;
    $("gtypes").innerHTML = d.types.map(function (t) {
      return '<button type="button" data-t="' + esc(t.slug) + '"' + (t.open ? "" : " disabled") + ' aria-pressed="' + (t.slug === gtype) + '">' + esc(t.both ? "Both nights" : t.name) + (t.open ? "" : "<small>closed</small>") + "</button>";
    }).join("");
    if (!open.length) { $("gf").hidden = true; $("full").hidden = false; $("full").textContent = "Doors are open, so the guest list is closed."; }
    $("glist").innerHTML = d.guests.length ? d.guests.map(function (g) {
      return '<div class="guest"><div><b>' + esc(g.name) + '</b><span>' + esc(g.type) + (g.in ? " · ✓ in" : "") + " · " + esc(g.email || "") + "</span></div>" +
        (g.can_remove ? '<button type="button" data-rm="' + esc(g.ticket_id) + '">Remove</button>' : "") + "</div>";
    }).join("") : '<div class="empty">No one on your list yet.</div>';
  }
  $("gtypes").addEventListener("click", function (e) { var b = e.target.closest("[data-t]"); if (!b || b.disabled) return; gtype = b.getAttribute("data-t"); draw(S); });

  // ---- claim ----
  $("cf").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = fullName($("cname").value);
    if (!name) return ($("cmsg").textContent = "Enter your full name (first and last).");
    if (!checkEmail($("cemail"), $("cemailh"))) return ($("cmsg").textContent = "Enter the email your pass should go to.");
    if (!checkPhone($("cphone"), $("cphoneh"))) return ($("cmsg").textContent = "Enter a phone number we can reach you at.");
    $("cgo").disabled = true; $("cmsg").textContent = "Making your pass...";
    call("claim", { name: name, email: $("cemail").value.trim().toLowerCase(), phone: $("cphone").value }).then(function (d) { draw(d); scrollTo(0, 0); })
      .catch(function (err) { $("cgo").disabled = false; $("cmsg").textContent = err.message; });
  });

  // ---- guests ----
  $("gf").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = fullName($("gname").value);
    if (!gtype) return ($("gmsg").textContent = "Pick which night they're coming.");
    if (!name) return ($("gmsg").textContent = "Enter their full name (first and last).");
    if (!checkEmail($("gemail"), $("gemailh"))) return ($("gmsg").textContent = "Enter the email their ticket should go to.");
    if (!checkPhone($("gphone"), $("gphoneh"))) return ($("gmsg").textContent = "Enter a phone number we can reach them at.");
    $("ggo").disabled = true; $("gmsg").textContent = "Adding...";
    call("guest", { type: gtype, name: name, email: $("gemail").value.trim().toLowerCase(), phone: $("gphone").value }).then(function (d) {
      $("ggo").disabled = false; $("gname").value = ""; $("gemail").value = ""; $("gphone").value = "";
      $("gmsg").textContent = "Added. " + name.split(" ")[0] + "'s ticket is in their email."; draw(d);
    }).catch(function (err) { $("ggo").disabled = false; $("gmsg").textContent = err.message; });
  });
  $("glist").addEventListener("click", function (e) {
    var b = e.target.closest("[data-rm]"); if (!b) return;
    if (!confirm("Take them off your list? Their ticket stops working.")) return;
    b.disabled = true;
    call("remove", { ticket_id: b.getAttribute("data-rm") }).then(draw).catch(function (err) { b.disabled = false; $("gmsg").textContent = err.message; });
  });
  $("resend").addEventListener("click", function () {
    $("resend").disabled = true; $("pmsg").textContent = "Sending...";
    call("resend", {}).then(function (r) { $("pmsg").textContent = r.sent ? "Sent. Check your inbox (and spam)." : "Couldn't send right now. Try again in a minute."; $("resend").disabled = false; })
      .catch(function (err) { $("pmsg").textContent = err.message; $("resend").disabled = false; });
  });

  call("get").then(draw).catch(function (err) { $("msg").textContent = err.message; });
})();
