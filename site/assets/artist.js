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
    if (!d.artist.claimed) return;
    $("passline").innerHTML = "Sent to <b>" + esc(d.artist.email || "") + "</b>. Good both nights" + (d.event.nights[0] ? ", doors " + time(d.event.nights[0].starts_at) : "") + ". Show the QR at the door.";
    if (d.pass) $("openpass").href = d.pass.url;
    drawProfile(d.profile || {});
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
    call("claim", { name: name, email: $("cemail").value.trim().toLowerCase(), phone: $("cphone").value }).then(function (d) { draw(d); loadTracks(d); scrollTo(0, 0); })
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

  // ---- your profile: what fans see when they tap your name in the lineup ----
  var PF = { instagram: "pfig", soundcloud: "pfsc", spotify: "pfsp", tiktok: "pftt", youtube: "pfyt", website: "pfweb" };
  var pfLoaded = false;
  function drawProfile(p) {
    $("pfimg").innerHTML = p.photo_url ? '<img src="' + esc(p.photo_url) + '" alt="">' : "";
    $("pfpick").textContent = p.photo_url ? "Change photo" : "Add a photo";
    var has = p.photo_url || p.bio || p.hometown || p.genre || Object.keys(p.links || {}).length;
    $("pfstate").textContent = has ? "Live on the lineup" : "Not filled in yet";
    if (pfLoaded) return;   // don't overwrite what they're typing when the page refreshes
    pfLoaded = true;
    $("pfhome").value = p.hometown || ""; $("pfgenre").value = p.genre || ""; $("pfbio").value = p.bio || ""; $("pfrider").value = p.rider || "";
    Object.keys(PF).forEach(function (k) { $(PF[k]).value = (p.links || {})[k] || ""; });
    $("pfbion").textContent = $("pfbio").value.length;
  }
  $("pfbio").addEventListener("input", function () { $("pfbion").textContent = $("pfbio").value.length; });
  $("pf").addEventListener("submit", function (e) {
    e.preventDefault();
    var links = {}; Object.keys(PF).forEach(function (k) { links[k] = $(PF[k]).value.trim(); });
    $("pfgo").disabled = true; $("pfmsg").textContent = "Saving...";
    call("profile", { bio: $("pfbio").value, hometown: $("pfhome").value, genre: $("pfgenre").value, rider: $("pfrider").value, links: links })
      .then(function (d) { pfLoaded = false; draw(d); $("pfmsg").textContent = "Saved. It's on the lineup now."; $("pfgo").disabled = false; })
      .catch(function (err) { $("pfmsg").textContent = err.message; $("pfgo").disabled = false; });
  });
  $("pfpick").addEventListener("click", function () { $("pffile").click(); });
  $("pffile").addEventListener("change", function () {
    var f = $("pffile").files[0]; $("pffile").value = ""; if (!f) return;
    var ext = (f.name.split(".").pop() || "").toLowerCase(); if (ext === "jpeg") ext = "jpg";
    if (["jpg", "png", "webp"].indexOf(ext) < 0) { $("pfmsg").textContent = "Use a JPG, PNG or WebP photo."; return; }
    if (f.size > 5 * 1048576) { $("pfmsg").textContent = "That photo is over 5 MB. Use a smaller one."; return; }
    $("pfpick").disabled = true; $("pfmsg").textContent = "Uploading photo...";
    call("photo-url", { ext: ext }).then(function (r) {
      return fetch(r.upload_url, { method: "PUT", headers: { "Content-Type": r.content_type }, body: f }).then(function (x) { if (!x.ok) throw new Error("Upload failed. Try again."); return r.path; });
    }).then(function (path) { return call("photo", { path: path }); })
      .then(function (d) { draw(d); $("pfmsg").textContent = "Photo added."; $("pfpick").disabled = false; })
      .catch(function (err) { $("pfmsg").textContent = err.message; $("pfpick").disabled = false; });
  });

  // ---- your tracks: add music to this show's playlist ----
  var PL = (C.supabaseUrl || "") + "/functions/v1/playlist";
  function pl(a, body) {
    var o = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ a: a, k: k }, body)) } : {};
    return fetch(PL + (body ? "" : "?a=" + a + "&k=" + k), o).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong. Try again."); return j; }); });
  }
  // Upload one file to a one-time link; the cover or the track itself.
  function put(r, f, label) {
    return new Promise(function (ok, no) {
      var x = new XMLHttpRequest(); x.open("PUT", r.upload_url, true); x.setRequestHeader("Content-Type", r.content_type);
      x.upload.onprogress = function (ev) { if (ev.lengthComputable && label) $("tmsg").textContent = label + Math.round(ev.loaded / ev.total * 100) + "%"; };
      x.onload = function () { x.status < 300 ? ok(r.path) : no(new Error("Upload failed. Try again.")); }; x.onerror = function () { no(new Error("Upload failed. Check your connection.")); };
      x.send(f);
    });
  }
  function artExt(f) { var e = (f.name.split(".").pop() || "").toLowerCase(); return e === "jpeg" ? "jpg" : e; }
  function artCheck(f) {
    if (["jpg", "png", "webp"].indexOf(artExt(f)) < 0) return "Use a JPG, PNG or WebP for the cover.";
    if (f.size > 5 * 1048576) return "That cover is over 5 MB. Use a smaller image.";
    return "";
  }
  function uploadArt(f) { return pl("artist-upload-url", { kind: "art", ext: artExt(f) }).then(function (r) { return put(r, f, "Uploading cover… "); }); }
  var artFor = null;
  $("tartpick").addEventListener("change", function () {
    var f = $("tartpick").files[0], id = artFor; $("tartpick").value = ""; if (!f || !id) return;
    var bad = artCheck(f); if (bad) { $("tmsg").textContent = bad; return; }
    uploadArt(f).then(function (path) { return pl("artist-art", { id: id, art_path: path }); })
      .then(function (d) { $("tmsg").textContent = "Cover added."; drawTracks(d); })
      .catch(function (err) { $("tmsg").textContent = err.message; });
  });
  function drawTracks(d) {
    var full = d.tracks.length >= d.max;
    $("tcount").textContent = d.tracks.length + " of " + d.max;
    $("tf").hidden = full; $("tfull").hidden = !full;
    $("tlist").innerHTML = d.tracks.length ? d.tracks.map(function (t) {
      return '<div class="guest trk"><div class="tart">' + (t.art_url ? '<img src="' + esc(t.art_url) + '" alt="">' : "") + '</div><div class="tinfo"><b>' + esc(t.title) + "</b><span>In the mix · free download " + (t.free_download ? "on" : "off") + "</span></div>" +
        '<div class="tbtns"><button type="button" data-art="' + esc(t.id) + '">' + (t.art_url ? "Change cover" : "Add cover") + '</button><button type="button" data-free="' + esc(t.id) + '" data-on="' + (t.free_download ? "1" : "") + '">' + (t.free_download ? "Turn off download" : "Make it free") + '</button><button type="button" data-trm="' + esc(t.id) + '">Remove</button></div></div>';
    }).join("") : '<div class="empty">No tracks yet.</div>';
  }
  $("tfile").addEventListener("change", function () { var f = $("tfile").files[0]; if (f && !$("ttitle").value) $("ttitle").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80); });
  $("tlist").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-art")) { artFor = b.getAttribute("data-art"); $("tartpick").click(); return; }
    var job = b.hasAttribute("data-trm") ? pl("artist-remove", { id: b.getAttribute("data-trm") }) : b.hasAttribute("data-free") ? pl("artist-set", { id: b.getAttribute("data-free"), free_download: !b.getAttribute("data-on") }) : null;
    if (!job) return; b.disabled = true;
    job.then(drawTracks).catch(function (err) { $("tmsg").textContent = err.message; b.disabled = false; });
  });
  $("tf").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = $("tfile").files[0], title = $("ttitle").value.trim(), ext = f ? (f.name.split(".").pop() || "").toLowerCase() : "";
    if (!f) { $("tmsg").textContent = "Pick a track first."; return; }
    if (["mp3", "wav", "m4a"].indexOf(ext) < 0) { $("tmsg").textContent = "Use an MP3, WAV or M4A."; return; }
    if (f.size > 50 * 1048576) { $("tmsg").textContent = "That track is over 50 MB (the most the site can take right now). Export it as a 320 kbps MP3 and it will fit."; return; }
    if (!title) { $("tmsg").textContent = "Give it a title."; $("ttitle").focus(); return; }
    var cover = $("tart").files[0], bad = cover ? artCheck(cover) : "";
    if (bad) { $("tmsg").textContent = bad; return; }
    $("tgo").disabled = true; $("tmsg").textContent = "Uploading… 0%";
    var artPath = null;
    (cover ? uploadArt(cover).then(function (p) { artPath = p; }) : Promise.resolve())
      .then(function () { return pl("artist-upload-url", { ext: ext }); })
      .then(function (r) { return put(r, f, "Uploading… "); })
      .then(function (path) { return pl("artist-add", { path: path, title: title, free_download: $("tfree").checked, art_path: artPath }); })
      .then(function (d) { $("tf").reset(); $("tgo").disabled = false; $("tmsg").textContent = "Added. It's in the mix."; drawTracks(d); })
      .catch(function (err) { $("tgo").disabled = false; $("tmsg").textContent = err.message; });
  });
  function loadTracks(d) { if (d && d.artist && d.artist.claimed) pl("artist").then(drawTracks).catch(function () {}); return d; }

  call("get").then(function (d) { draw(d); loadTracks(d); }).catch(function (err) { $("msg").textContent = err.message; });
})();
