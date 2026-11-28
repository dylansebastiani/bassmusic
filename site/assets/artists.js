/* Artist waitlist page: four fields, one button. Saves to the artist waitlist (its own list, separate from fans). */
(function () {
  var S = window.Stack, $ = function (id) { return document.getElementById(id); };
  var EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
  function tell(t) { $("awMsg").textContent = t || ""; }
  S.pageview("/artists");
  // Same move as the homepage: fly into the art as the first screen scrolls away, and the bar goes solid after it.
  (function () {
    var img = document.querySelector(".hero-art img"), hero = document.querySelector(".hero"), bar = document.getElementById("sx-bar");
    var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches, tick = false;
    function draw() { tick = false;
      var h = hero.offsetHeight || 1, t = Math.min(1, Math.max(0, scrollY / h));
      if (bar) bar.classList.toggle("solid", scrollY > h - 70);
      if (innerWidth < 900 && !still) { img.style.transform = "scale(" + (1 + t * 0.9).toFixed(3) + ")"; img.style.opacity = (1 - t * t).toFixed(3); }
      else { img.style.transform = ""; img.style.opacity = ""; }
    }
    addEventListener("scroll", function () { if (!tick) { tick = true; requestAnimationFrame(draw); } }, { passive: true });
    draw();
  })();
  $("aw").addEventListener("submit", function (e) {
    e.preventDefault();
    var artist = $("awArtist").value.trim(), full = $("awFull").value.trim(), em = $("awEmail").value.trim(), ph = $("awPhone").value.trim();
    if (!artist) { tell("Add your artist name."); $("awArtist").focus(); return; }
    if (!full) { tell("Add your full name."); $("awFull").focus(); return; }
    if (!EMAIL_OK.test(em)) { tell("That email doesn't look right."); $("awEmail").focus(); return; }
    if (ph.replace(/\D/g, "").length < 7) { tell("Add a phone number we can reach you on."); $("awPhone").focus(); return; }
    $("awBtn").disabled = true; tell("");
    S.api("artist-waitlist", { artist_name: artist, full_name: full, email: em, phone: ph, hp: $("awHp").value })
      .then(function () { $("aw").hidden = true; $("done").hidden = false; $("done").scrollIntoView({ block: "center" }); })
      .catch(function (err) { $("awBtn").disabled = false; tell(err.status ? (err.message || "Couldn't save that. Try again.") : "No signal. Try again in a sec."); });
  });
})();
