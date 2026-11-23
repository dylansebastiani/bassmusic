/* QR landing: /t?c=CODE[&e=show]. A remembered phone unlocks with no typing; anyone else gives an email and is in. */
(function () {
  var S = window.Stack, $ = function (id) { return document.getElementById(id); };
  var c = (S.q.get("c") || window.__QR || "").trim();
  var d = (S.q.get("d") || "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d)) return artistTrack(d);
  if (!c) { location.replace("/"); return; }
  S.pageview("/t");
  function toCollection(slug) { location.replace("/collection.html" + (slug ? "?new=" + encodeURIComponent(slug) : "")); }
  function showForm(meta) {
    $("status").textContent = "";
    $("join").hidden = false;
    window.Join.mount($("join"), { track: c, cta: "Unlock this track", hint: "Free. Already in? Same email, no code needed: it goes straight into your collection.", onDone: function (r) { toCollection(r.track && r.track.slug || meta && meta.slug); } });
  }
  function dead() {
    $("title").textContent = "This code isn't active"; $("sub").innerHTML = 'Check the QR code, or <a href="/" style="color:var(--hot)">start from the homepage</a>.';
    $("eyebrow").hidden = true;
  }
  S.get("track", { c: c, e: S.attr.e || null }).then(function (meta) {
    $("title").textContent = meta.title;
    $("eyebrow").textContent = meta.artist ? meta.artist : "Unreleased";
    $("sub").textContent = "Unreleased. Unlock it into your collection.";
    if (meta.artwork_url) { $("cover").src = meta.artwork_url; $("cover").classList.remove("blank"); }
    $("cover").hidden = !meta.artwork_url;
    var t = S.token();
    if (!t) return showForm(meta);
    $("status").textContent = "Adding it to your collection...";
    S.api("track", { c: c, t: t, e: S.attr.e || null }).then(function (r) { toCollection(r.slug); })
      .catch(function (err) {
        if (err.status === 404) { S.forget(); return showForm(meta); }
        $("status").innerHTML = 'Couldn\'t reach us. <button type="button" class="hint" id="retry">Try again</button>';
        $("retry").addEventListener("click", function () { location.reload(); });
      });
  }).catch(function (err) { if (err.status === 404) dead(); else { $("title").textContent = "No signal"; $("sub").textContent = "Check your connection and scan again."; } });

  // An artist's free download (/t?d=TRACK): the same steps as every track. Email first (a remembered
  // phone skips it), then first name, phone and ZIP once, then the file. The fan lands on that artist's list.
  function artistTrack(id) {
    S.pageview("/t");
    var C = S.C, esc = S.esc, LINKS = { instagram: "Instagram", soundcloud: "SoundCloud", spotify: "Spotify", tiktok: "TikTok", youtube: "YouTube", website: "Website" }, meta = {};
    var consent = S.fill ? S.fill(C.smsConsentText, { LABEL_NAME: C.labelName }) : String(C.smsConsentText || "").replace("{{LABEL_NAME}}", C.labelName || "");
    function status(t) { $("status").textContent = t || ""; }
    function emailStep() {
      $("join").hidden = false;
      window.Join.mount($("join"), { cta: "Unlock this track", hint: "Free. Already in? Same email, no code needed.", onDone: function () { $("join").innerHTML = ""; $("join").hidden = true; go(); } });
    }
    function wall() {
      status(""); $("join").hidden = false;
      $("join").innerHTML = '<form id="wall" class="wall" novalidate>' +
        '<p class="gate">Drop your name, number and ZIP to unlock it. One time, then every track opens.</p>' +
        '<label for="first_name">First name</label><input type="text" id="first_name" autocomplete="given-name" placeholder="first name" required>' +
        '<div class="row2"><div><label for="phone">Phone</label><input type="tel" id="phone" autocomplete="tel" placeholder="phone" required></div>' +
        '<div><label for="zip">ZIP</label><input type="text" id="zip" inputmode="numeric" autocomplete="postal-code" placeholder="zip" required></div></div>' +
        '<label class="check"><input type="checkbox" id="sms"><span>Text me show alerts and drops<small>' + esc(consent) + "</small></span></label>" +
        '<label class="check"><input type="checkbox" id="age"><span>' + esc(C.ageText || "I'm 13 or older.") + "</span></label>" +
        '<button type="submit" class="btn" id="wallBtn">Unlock the track</button><div class="msg" id="wallMsg" role="status"></div></form>';
      $("wall").addEventListener("submit", function (e) {
        e.preventDefault();
        var name = $("first_name").value.trim(), phone = $("phone").value.trim(), zip = $("zip").value.trim(), m = $("wallMsg");
        var no = function (t, f) { m.textContent = t; f.focus(); };
        if (!name) return no("Add your first name.", $("first_name"));
        if (phone.replace(/\D/g, "").length < 10) return no("Add your phone number.", $("phone"));
        if (!/^\d{5}(-?\d{4})?$/.test(zip)) return no("Add your ZIP.", $("zip"));
        if (!$("age").checked) return no("Tick the box to confirm you're 13 or older.", $("age"));
        $("wallBtn").disabled = true; m.textContent = "Unlocking...";
        S.api("profile", { t: S.token(), unlock: true, first_name: name, zip: zip, phone: phone, sms_consent: $("sms").checked, age_confirmed: true })
          .then(function () { $("join").innerHTML = ""; $("join").hidden = true; go(); })
          .catch(function (err) { $("wallBtn").disabled = false; m.textContent = err.message || "Couldn't save. Try again."; });
      });
    }
    function done(url) {
      var follow = Object.keys(LINKS).filter(function (k) { return meta.links && /^https:\/\//.test(meta.links[k] || ""); })
        .map(function (k) { return '<a class="btn ghost" href="' + esc(meta.links[k]) + '" target="_blank" rel="noopener nofollow">' + LINKS[k] + "</a>"; }).join("");
      $("sub").textContent = "It's yours. The download is starting.";
      $("join").hidden = false;
      $("join").innerHTML = '<a class="btn" href="' + esc(url) + '" rel="noopener">Download again</a>' +
        (follow ? '<p class="lead">Follow ' + esc(meta.artist || "the artist") + "</p>" + follow : "") +
        '<p><a class="hint" href="/collection.html">Open my collection</a></p>';
      status(""); location.href = url;
    }
    function go() {
      if (!S.token()) return emailStep();
      status("Getting it...");
      S.api("playlist", { a: "member-dl", id: id, t: S.token() }).then(function (r) { if (r.need_profile) return wall(); done(r.url); })
        .catch(function (err) {
          if (err.status === 401) { S.forget(); status(""); return emailStep(); }
          status(err.message || "Couldn't reach us. Try again.");
        });
    }
    S.get("playlist", { a: "meta", id: id }).then(function (m) {
      meta = m;
      $("title").textContent = m.title;
      $("eyebrow").textContent = m.artist || "Free download";
      $("sub").textContent = "Free download. Unlock it and it's yours.";
      if (m.artwork_url) { $("cover").src = m.artwork_url; $("cover").classList.remove("blank"); }
      $("cover").hidden = !m.artwork_url;
      document.title = "Download " + m.title;
      go();
    }).catch(function (err) {
      if (err.status === 404) { $("title").textContent = "Not a free download"; $("sub").innerHTML = 'The artist turned downloads off for this one. <a href="/" style="color:var(--hot)">Back to the homepage</a>.'; $("eyebrow").hidden = true; }
      else { $("title").textContent = "No signal"; $("sub").textContent = "Check your connection and try again."; }
    });
  }
})();
