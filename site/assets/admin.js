/* Staff page. Sign in with an emailed code; the session token lives on this phone. */
(function () {
  var S = window.Stack, C = S.C, $ = function (id) { return document.getElementById(id); }, esc = S.esc;
  var FN = (C.supabaseUrl || "") + "/functions/v1/admin";
  var AKEY = "stack_admin", tok = null;
  try { tok = localStorage.getItem(AKEY); } catch (e) {}
  var TABS = ["tracks", "members", "numbers", "events", "staff"], data = null;

  function call(a, body, raw) {
    var o = { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" } };
    if (tok) o.headers["x-admin-token"] = tok;
    if (body) o.body = JSON.stringify(body);
    return fetch(FN + "?a=" + a, o).then(function (r) {
      if (raw) return r;
      return r.json().then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || "request failed"), { status: r.status }); return j; });
    });
  }
  function say(id, t) { $(id).textContent = t; }
  function show(name) {
    TABS.forEach(function (n) { $("p-" + n).hidden = n !== name; });
    Array.prototype.forEach.call(document.querySelectorAll("#tabs [data-tab]"), function (b) { b.setAttribute("aria-selected", b.getAttribute("data-tab") === name ? "true" : "false"); });
    scrollTo(0, 0);
  }
  $("tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) show(b.getAttribute("data-tab")); });
  $("signout").addEventListener("click", function () { try { localStorage.removeItem(AKEY); } catch (e) {} location.reload(); });

  // ---------- sign in ----------
  var email = "";
  $("lf").addEventListener("submit", function (e) {
    e.preventDefault(); email = $("aemail").value.trim(); say("lmsg", "Sending...");
    call("login", { email: email }).then(function (r) { $("cf").hidden = false; say("lmsg", r.note || "Code sent. Check your email."); $("acode").focus(); })
      .catch(function (err) { say("lmsg", err.message); });
  });
  $("cf").addEventListener("submit", function (e) {
    e.preventDefault(); say("lmsg", "Checking...");
    call("verify", { email: email, code: $("acode").value }).then(function (r) { tok = r.token; try { localStorage.setItem(AKEY, tok); } catch (x) {} boot(); })
      .catch(function (err) { say("lmsg", err.message); });
  });

  // ---------- render ----------
  function num(n) { return (n || 0).toLocaleString(); }
  function fmt(s) { return s ? S.fmtDate(s, true) : ""; }
  function qrBlock(t) {
    if (!t.qr_code) return "";
    var svg = FN + "?a=qr.svg&c=" + encodeURIComponent(t.qr_code);
    return '<div class="qr"><img alt="QR code" data-svg="' + esc(svg) + '"><div><div class="mono">' + esc(t.qr_url) + '</div>' +
      '<div class="when">' + num(t.scans.view) + " views · " + num(t.scans.unlocked) + " unlocks</div>" +
      '<a class="btn ghost" href="' + esc(svg) + '" download="' + esc(t.slug) + '-qr.svg" data-dl>Download QR (SVG)</a></div></div>';
  }
  function paint(d) {
    data = d;
    $("tracks").innerHTML = d.tracks.length ? d.tracks.map(function (t) {
      return '<article class="card"><h3>' + esc(t.title) + "</h3>" + (t.artist ? '<div class="by">' + esc(t.artist) + "</div>" : "") +
        (t.is_current ? '<span class="chip">Welcome track</span>' : "") + qrBlock(t) + "</article>";
    }).join("") : '<div class="empty">No tracks yet. Add one below.</div>';
    // QR images and downloads need the token, so fetch them and swap in a blob.
    Array.prototype.forEach.call($("tracks").querySelectorAll("img[data-svg]"), function (img) {
      fetch(img.getAttribute("data-svg"), { headers: { "x-admin-token": tok } }).then(function (r) { return r.blob(); }).then(function (b) {
        var u = URL.createObjectURL(b); img.src = u; var a = img.parentNode.querySelector("[data-dl]"); if (a) a.href = u;
      });
    });
    $("mstats").innerHTML = '<div class="stat"><b>' + num(d.members) + "</b><span>Members</span></div><div class=\"stat\"><b>" + num(d.with_info) + "</b><span>With name, phone, ZIP</span></div>";
    $("atable").querySelector("tbody").innerHTML = d.artists.map(function (a) { return "<tr><td>" + esc(a.artist) + '</td><td class="num">' + a.tracks + '</td><td class="num">' + num(a.view) + '</td><td class="num">' + num(a.unlocked) + "</td></tr>"; }).join("");
    $("ttable").querySelector("tbody").innerHTML = d.tracks.map(function (t) { return "<tr><td>" + esc(t.title) + (t.artist ? " · " + esc(t.artist) : "") + '</td><td class="num">' + num(t.scans.view) + '</td><td class="num">' + num(t.scans.unlocked) + '</td><td class="num">' + num(t.scans.already) + "</td></tr>"; }).join("");
    $("events").innerHTML = d.events.length ? d.events.map(function (e) {
      return '<article class="card"><span class="chip">' + esc(e.kind) + "</span><h3>" + esc(e.name) + "</h3>" + (e.starts_at ? '<div class="when">' + esc(fmt(e.starts_at)) + "</div>" : "") + (e.city ? '<div class="where">' + esc(e.city) + "</div>" : "") +
        '<div class="mono" style="text-transform:none;letter-spacing:0;word-break:break-all">' + esc((C.siteUrl || "") + "/?e=" + e.slug) + "</div></article>";
    }).join("") : '<div class="empty">No events yet.</div>';
  }
  function loadMembers() {
    call("members").then(function (r) {
      $("mtable").querySelector("tbody").innerHTML = r.members.map(function (m) {
        return "<tr><td>" + esc(m.email) + "</td><td>" + esc(m.first_name || "") + "</td><td>" + esc(m.phone || "") + "</td><td>" + esc(m.zip || "") + "</td><td>" + esc(m.source || "") + '</td><td class="num">' + m.tracks + "</td><td>" + esc(S.fmtDate(m.joined)) + "</td></tr>";
      }).join("");
    }).catch(function () {});
  }
  function loadStaff() {
    call("admins").then(function (r) {
      $("staff").className = "list staff";
      $("staff").innerHTML = r.emails.map(function (e) { return "<li>" + esc(e) + ' <button type="button" data-rm="' + esc(e) + '">Remove</button></li>'; }).join("");
    }).catch(function () {});
  }
  function boot() {
    call("overview").then(function (d) {
      $("login").hidden = true; $("app").hidden = false; $("tabs").hidden = false; $("signout").hidden = false;
      paint(d); loadMembers(); loadStaff(); show("tracks");
    }).catch(function (err) {
      if (err.status === 401) { tok = null; try { localStorage.removeItem(AKEY); } catch (e) {} }
      $("login").hidden = false;
    });
  }

  // ---------- add a track: three uploads straight to storage, then the row ----------
  function upload(slug, kind, file, onPct) {
    return call("upload-url", { slug: slug, kind: kind, filename: file.name }).then(function (r) {
      return new Promise(function (res, rej) {
        var x = new XMLHttpRequest(); x.open("PUT", r.url, true);
        x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        x.upload.onprogress = function (e) { if (e.lengthComputable) onPct(e.loaded / e.total); };
        x.onload = function () { x.status < 300 ? res(r.path) : rej(new Error("Upload failed (" + x.status + ")")); };
        x.onerror = function () { rej(new Error("Upload failed. Check the connection.")); };
        x.send(file);
      });
    });
  }
  $("tf").addEventListener("submit", function (e) {
    e.preventDefault();
    var title = $("t_title").value.trim(), artist = $("t_artist").value.trim(), audio = $("t_audio").files[0], wav = $("t_wav").files[0], cover = $("t_cover").files[0];
    if (!title) return say("tmsg", "Add a title.");
    if (!audio) return say("tmsg", "Pick the audio file.");
    if (wav && wav.size > 50 * 1024 * 1024) return say("tmsg", "That WAV is over 50 MB. Use a 16-bit version.");
    var slug = (artist + " " + title).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    $("t_go").disabled = true;
    var bar = document.createElement("div"); bar.className = "bar"; bar.innerHTML = "<i></i>"; $("tmsg").textContent = ""; $("tmsg").appendChild(bar);
    var i = bar.firstChild, paths = {};
    var steps = [["audio", audio]].concat(wav ? [["wav", wav]] : []).concat(cover ? [["cover", cover]] : []);
    var total = steps.reduce(function (n, s) { return n + s[1].size; }, 0), done = 0;
    steps.reduce(function (p, s) {
      return p.then(function () { return upload(slug, s[0], s[1], function (pct) { i.style.width = Math.round(100 * (done + pct * s[1].size) / total) + "%"; }).then(function (path) { paths[s[0]] = path; done += s[1].size; }); });
    }, Promise.resolve()).then(function () {
      return call("track", { slug: slug, title: title, artist: artist || null, description: $("t_desc").value.trim() || null,
        audio_path: paths.audio, download_path: paths.wav || null, artwork_path: paths.cover || null, is_current: $("t_current").checked });
    }).then(function (r) {
      say("tmsg", "Saved. QR code: " + r.qr_url); $("tf").reset(); $("t_go").disabled = false; $("addTrack").open = false;
      return call("overview").then(paint);
    }).catch(function (err) { say("tmsg", err.message); $("t_go").disabled = false; });
  });

  // ---------- events ----------
  $("ef").addEventListener("submit", function (e) {
    e.preventDefault(); say("emsg", "Saving...");
    var v = function (id) { return $(id).value.trim() || null; };
    var local = function (id) { var x = $(id).value; return x ? new Date(x).toISOString() : null; };
    call("event", { name: v("e_name"), kind: $("e_kind").value, venue: v("e_venue"), city: v("e_city"), address: v("e_address"), starts_at: local("e_start"), ends_at: local("e_end"),
      ticket_url: v("e_ticket"), prize: v("e_prize"), description: v("e_desc") })
      .then(function (r) { say("emsg", "Saved. Show link: " + r.show_url); $("ef").reset(); return call("overview").then(paint); })
      .catch(function (err) { say("emsg", err.message); });
  });

  // ---------- members: CSV and Brevo ----------
  $("csv").addEventListener("click", function () {
    call("members.csv", null, true).then(function (r) { return r.blob(); }).then(function (b) {
      var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "members.csv"; document.body.appendChild(a); a.click(); a.remove();
    });
  });
  $("brevoBtn").addEventListener("click", function () {
    var box = $("brevo"); box.hidden = false; box.innerHTML = "Loading Brevo lists...";
    call("brevo-lists").then(function (r) {
      if (!r.lists.length) { box.innerHTML = "No Brevo lists found. Make one in Brevo first, or check the API key."; return; }
      box.innerHTML = '<div class="sub mono">Brevo list that gets every member</div><select id="blist">' + r.lists.map(function (l) { return '<option value="' + l.id + '"' + (l.id === r.list_id ? " selected" : "") + ">" + esc(l.name) + " (" + l.count + ")</option>"; }).join("") + "</select>" +
        '<div class="row2"><button type="button" class="btn ghost" id="bsave">Use this list</button><button type="button" class="btn" id="bsync">Send everyone now</button></div><div class="msg" id="bmsg"></div>';
      $("bsave").addEventListener("click", function () { call("brevo-list", { list_id: Number($("blist").value) }).then(function () { say("bmsg", "Saved. New signups go to this list automatically."); }).catch(function (e) { say("bmsg", e.message); }); });
      $("bsync").addEventListener("click", function () {
        say("bmsg", "Sending..."); $("bsync").disabled = true;
        call("brevo-sync").then(function (r) { say("bmsg", r.sent + " sent" + (r.failed ? ", " + r.failed + " failed (" + (r.error || "") + ")" : ".")); $("bsync").disabled = false; }).catch(function (e) { say("bmsg", e.message); $("bsync").disabled = false; });
      });
    });
  });

  // ---------- staff ----------
  $("sf").addEventListener("submit", function (e) { e.preventDefault(); call("admin-add", { email: $("s_email").value.trim() }).then(function () { $("s_email").value = ""; say("smsg", "Added."); loadStaff(); }).catch(function (err) { say("smsg", err.message); }); });
  $("staff").addEventListener("click", function (e) { var b = e.target.closest("[data-rm]"); if (!b) return; call("admin-remove", { email: b.getAttribute("data-rm") }).then(loadStaff).catch(function (err) { say("smsg", err.message); }); });

  S.pageview("/admin");
  if (tok) boot();
})();
