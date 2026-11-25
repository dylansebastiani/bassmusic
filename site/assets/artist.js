/* An artist's private page: claim the gold Artist Pass, then run their own guest list. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/artist";
  var SALES = (C.supabaseUrl || "") + "/functions/v1/artist-sales";

  // ---- Sell tickets: their personal link + code, and how many tickets they've moved ----
  var sell = null;
  function loadSell() {
    fetch(SALES + "?k=" + encodeURIComponent(k)).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.link) return;
      sell = d; $("sell").hidden = false;
      $("sellcount").textContent = d.tickets + (d.tickets === 1 ? " ticket" : " tickets") + " sold";
      $("selllink").textContent = d.link.replace(/^https?:\/\//, "");
      $("sellcode").textContent = d.code || "";
      var qr = SALES + "?a=qr&k=" + encodeURIComponent(k);
      $("sellqr").src = qr; $("sellqra").href = qr;
    }).catch(function () {});
  }
  function copyText(t, msg) {
    var done = function () { $("smsg").textContent = msg; setTimeout(function () { $("smsg").textContent = ""; }, 2500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { window.prompt("Copy this:", t); });
    else window.prompt("Copy this:", t);
  }
  document.addEventListener("click", function (e) {
    if (!sell) return;
    if (e.target.id === "sellshare") {
      if (navigator.share) navigator.share({ title: sell.show || "Tickets", text: "Get your tickets here:", url: sell.link }).catch(function () {});
      else copyText(sell.link, "Link copied. Post it anywhere.");
    }
    if (e.target.id === "sellcopy") copyText(sell.code, "Code copied: " + sell.code);
  });
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
    // Duo/group: one shared page for everyone on the pass.
    var mem = (d.artist.members || []), mx = $("amembers");
    if (mem.length > 1) {
      if (!mx) { mx = document.createElement("p"); mx.id = "amembers"; mx.className = "amembers"; $("aname").insertAdjacentElement("afterend", mx); }
      mx.textContent = mem.join(" & ") + " share this page: one profile, one guest list, one set of tracks.";
    } else if (mx) mx.remove();
    if ($("tasname")) { $("tasname").textContent = d.artist.name; preview(); }
    $("adates").textContent = d.event.nights.map(function (n) { return day(n.starts_at); }).join(" + ") + (d.event.city ? " · " + d.event.city : "") + (d.event.age ? " · " + d.event.age : "");
    $("claim").hidden = d.artist.claimed; $("dash").hidden = !d.artist.claimed;
    if (!d.artist.claimed) return;
    $("passline").innerHTML = "Sent to <b>" + esc(d.artist.email || "") + "</b>. Good both nights" + (d.event.nights[0] ? ", doors " + time(d.event.nights[0].starts_at) : "") + ". Show the QR at the door.";
    if (d.pass) $("openpass").href = d.pass.url;
    drawProfile(d.profile || {});
    loadSell();
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
  // Replace a track with a new version: same title, cover, fans and download setting.
  var swapFor = null;
  $("tswappick").addEventListener("change", function () {
    var f = $("tswappick").files[0], id = swapFor; $("tswappick").value = ""; if (!f || !id) return;
    var ext = (f.name.split(".").pop() || "").toLowerCase();
    if (["mp3", "wav", "m4a"].indexOf(ext) < 0) { $("tmsg").textContent = "Use an MP3, WAV or M4A."; return; }
    if (f.size > 50 * 1048576) { $("tmsg").textContent = "That track is over 50 MB (the most the site can take right now). Export it as a 320 kbps MP3 and it will fit."; return; }
    $("tmsg").textContent = "Uploading… 0%";
    pl("artist-upload-url", { ext: ext, replace: id }).then(function (r) { return put(r, f, "Uploading… "); })
      .then(function (path) { return pl("artist-file", { id: id, path: path }); })
      .then(function (d) { $("tmsg").textContent = "Replaced. The new version is in the mix."; drawTracks(d); })
      .catch(function (err) { $("tmsg").textContent = err.message; });
  });
  // Fans who downloaded: newest first, everything exportable in one tap.
  var FANS = [];
  function drawFans(list) {
    FANS = list || [];
    $("fans").hidden = !FANS.length;
    if (!FANS.length) return;
    var people = {}; FANS.forEach(function (f) { people[f.email] = 1; });
    var n = Object.keys(people).length;
    $("fcount").textContent = n + (n === 1 ? " fan" : " fans") + " · " + FANS.length + (FANS.length === 1 ? " download" : " downloads");
    $("flist").innerHTML = FANS.slice(0, 50).map(function (f) {
      return '<div class="guest"><div><b>' + esc(f.name) + "</b><span>" + esc(f.email) + " · " + esc(f.phone || "") + (f.zip ? " · " + esc(f.zip) : "") + "<br>" + esc(f.track_title || "") + " · " + new Date(f.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + "</span></div></div>";
    }).join("") + (FANS.length > 50 ? '<div class="empty">Showing the newest 50. The CSV has all ' + FANS.length + ".</div>" : "");
  }
  function csv(rows) {
    var cols = ["name", "email", "phone", "zip", "track_title", "created_at"], head = ["Name", "Email", "Phone", "ZIP", "Track", "Downloaded"];
    var q = function (v) { v = v == null ? "" : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [head.join(",")].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(","); })).join("\n");
  }
  $("fexport").addEventListener("click", function () {
    var blob = new Blob([csv(FANS)], { type: "text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = ((S && S.artist && S.artist.name) || "fans").replace(/[^\w -]+/g, "") + " - fans.csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  function drawTracks(d) {
    drawFans(d.downloads);
    var full = d.tracks.length >= d.max;
    $("tcount").textContent = d.tracks.length + " of " + d.max;
    $("tf").hidden = full; $("tfull").hidden = !full;
    $("tlist").innerHTML = d.tracks.length ? d.tracks.map(function (t) {
      var id = esc(t.id);
      return '<div class="trk2" data-id="' + id + '">' +
        '<button type="button" class="tcov" data-art="' + id + '" aria-label="' + (t.art_url ? "Change cover" : "Add a cover") + '">' + (t.art_url ? '<img src="' + esc(t.art_url) + '" alt="">' : "<em>+ Cover</em>") + "<span>Edit</span></button>" +
        '<div class="tbody"><div class="tname">' + esc(t.title) + "</div>" +
        '<div class="tact"><button type="button" data-ren="' + id + '" data-title="' + esc(t.title) + '">Rename</button><button type="button" data-swap="' + id + '">Replace file</button>' +
        '<label class="tsw"><input type="checkbox" data-freebox="' + id + '"' + (t.free_download ? " checked" : "") + '><i aria-hidden="true"></i>Free download</label>' +
        '<button type="button" class="tdel" data-trm="' + id + '">Remove</button></div></div></div>';
    }).join("") : '<div class="empty">No tracks yet.</div>';
  }
  $("tfile").addEventListener("change", function () { var f = $("tfile").files[0]; if (f && !$("ttitle").value) $("ttitle").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80); });
  $("tlist").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-art")) { artFor = b.getAttribute("data-art"); $("tartpick").click(); return; }
    if (b.hasAttribute("data-swap")) { swapFor = b.getAttribute("data-swap"); $("tswappick").click(); return; }
    if (b.hasAttribute("data-ren")) {
      // Rename in place: the title turns into a box with Save / Cancel.
      var info = b.closest(".tbody"), id = b.getAttribute("data-ren"), old = b.getAttribute("data-title");
      info.innerHTML = '<input type="text" class="tren" maxlength="80" aria-label="Track title"><div class="tact"><button type="button" class="tsave" data-rsave="' + esc(id) + '">Save</button><button type="button" data-rcancel>Cancel</button></div>';
      var box = info.querySelector(".tren"); box.value = old; box.focus(); box.select();
      box.addEventListener("keydown", function (ev) { if (ev.key === "Enter") info.querySelector("[data-rsave]").click(); if (ev.key === "Escape") info.querySelector("[data-rcancel]").click(); });
      return;
    }
    if (b.hasAttribute("data-rcancel")) { pl("artist").then(drawTracks).catch(function () {}); return; }
    if (b.hasAttribute("data-rsave")) {
      var t = b.closest(".tbody").querySelector(".tren").value.trim();
      if (!t) { $("tmsg").textContent = "Give it a title."; return; }
      b.disabled = true;
      pl("artist-rename", { id: b.getAttribute("data-rsave"), title: t }).then(function (d) { $("tmsg").textContent = "Renamed."; drawTracks(d); })
        .catch(function (err) { $("tmsg").textContent = err.message; b.disabled = false; });
      return;
    }
    if (b.hasAttribute("data-trm") && !confirm("Remove this track from the show? Fans won't hear it anymore.")) return;
    var job = b.hasAttribute("data-trm") ? pl("artist-remove", { id: b.getAttribute("data-trm") }) : null;
    if (!job) return; b.disabled = true;
    job.then(drawTracks).catch(function (err) { $("tmsg").textContent = err.message; b.disabled = false; });
  });
  // The free download switch saves as soon as it's flipped.
  $("tlist").addEventListener("change", function (e) {
    var box = e.target.closest("[data-freebox]"); if (!box) return;
    box.disabled = true;
    pl("artist-set", { id: box.getAttribute("data-freebox"), free_download: box.checked })
      .then(function (d) { $("tmsg").textContent = box.checked ? "Fans can download it free now." : "Free download is off."; drawTracks(d); })
      .catch(function (err) { box.checked = !box.checked; box.disabled = false; $("tmsg").textContent = err.message; });
  });
  // How the track will read in the player, so nobody types their own name as the song name.
  function preview() {
    var me = (S && S.artist && S.artist.name) || "your name", c = $("tcollab").value.trim(), t = $("ttitle").value.trim() || "Song name";
    $("tpreview").innerHTML = "Shows as: <b>" + esc(me + (c ? " x " + c : "")) + "</b> · " + esc(t);
  }
  $("ttitle").addEventListener("input", preview); $("tcollab").addEventListener("input", preview);
  $("tf").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = $("tfile").files[0], title = $("ttitle").value.trim(), ext = f ? (f.name.split(".").pop() || "").toLowerCase() : "";
    if (!f) { $("tmsg").textContent = "Pick a track first."; return; }
    if (["mp3", "wav", "m4a"].indexOf(ext) < 0) { $("tmsg").textContent = "Use an MP3, WAV or M4A."; return; }
    if (f.size > 50 * 1048576) { $("tmsg").textContent = "That track is over 50 MB (the most the site can take right now). Export it as a 320 kbps MP3 and it will fit."; return; }
    if (!title) { $("tmsg").textContent = "Type the song's name."; $("ttitle").focus(); return; }
    var myName = ((S && S.artist && S.artist.name) || "").trim().toLowerCase();
    if (myName && title.toLowerCase() === myName) { $("tmsg").textContent = "That's your artist name. It's added for you, so type the song's name here."; $("ttitle").focus(); return; }
    var cover = $("tart").files[0], bad = cover ? artCheck(cover) : "";
    // Every track needs a cover: it shows in the music bar while the track plays.
    if (!cover) { $("tmsg").textContent = "Add a cover picture for this track."; $("tart").focus(); return; }
    if (bad) { $("tmsg").textContent = bad; return; }
    $("tgo").disabled = true; $("tmsg").textContent = "Uploading… 0%";
    var artPath = null;
    (cover ? uploadArt(cover).then(function (p) { artPath = p; }) : Promise.resolve())
      .then(function () { return pl("artist-upload-url", { ext: ext }); })
      .then(function (r) { return put(r, f, "Uploading… "); })
      .then(function (path) { return pl("artist-add", { path: path, title: title, collab: $("tcollab").value.trim(), free_download: $("tfree").checked, art_path: artPath }); })
      .then(function (d) { $("tf").reset(); preview(); $("tgo").disabled = false; $("tmsg").textContent = "Added. It's in the mix."; drawTracks(d); })
      .catch(function (err) { $("tgo").disabled = false; $("tmsg").textContent = err.message; });
  });
  function loadTracks(d) { if (d && d.artist && d.artist.claimed) pl("artist").then(drawTracks).catch(function () {}); return d; }

  call("get").then(function (d) { draw(d); loadTracks(d); }).catch(function (err) { $("msg").textContent = err.message; });
})();
