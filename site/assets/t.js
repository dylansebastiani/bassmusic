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

  // An artist's free download (/t?d=TRACK): the same steps as every track. Email first (a remembered phone
  // skips it), then it goes into their collection, which asks first name / phone / ZIP once and has the download.
  function artistTrack(id) {
    S.pageview("/t");
    function status(t) { $("status").textContent = t || ""; }
    function go() {
      if (!S.token()) { status(""); $("join").hidden = false; return window.Join.mount($("join"), { cta: "Unlock this track", hint: "Free. Already in? Same email, no code needed: it goes straight into your collection.", onDone: function () { $("join").hidden = true; go(); } }); }
      status("Adding it to your collection...");
      S.api("playlist", { a: "member-dl", id: id, t: S.token() }).then(function (r) { toCollection(r.slug); })
        .catch(function (err) {
          if (err.status === 401) { S.forget(); return go(); }
          status(err.message || "Couldn't reach us. Try again.");
        });
    }
    S.get("playlist", { a: "meta", id: id }).then(function (m) {
      $("title").textContent = m.title;
      $("eyebrow").textContent = m.artist || "Free download";
      $("sub").textContent = "Free download. Unlock it into your collection.";
      if (m.artwork_url) { $("cover").src = m.artwork_url; $("cover").classList.remove("blank"); }
      $("cover").hidden = !m.artwork_url;
      go();
    }).catch(function (err) {
      if (err.status === 404) { $("title").textContent = "Not a free download"; $("sub").innerHTML = 'The artist turned downloads off for this one. <a href="/" style="color:var(--hot)">Back to the homepage</a>.'; $("eyebrow").hidden = true; }
      else { $("title").textContent = "No signal"; $("sub").textContent = "Check your connection and try again."; }
    });
  }
})();
