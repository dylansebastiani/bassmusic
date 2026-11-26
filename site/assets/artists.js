/* Artist waitlist page: email only. Saves to the artist waitlist (its own list, separate from fans). */
(function () {
  var S = window.Stack, $ = function (id) { return document.getElementById(id); };
  var EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
  function tell(t) { $("awMsg").textContent = t || ""; }
  S.pageview("/artists");
  // Same move as the homepage: fly into the art as the first screen scrolls away, and the bar goes solid after it.
  (function () {
    var img = document.querySelector(".hero-art img"), hero = document.querySelector(".hero"), bar = document.querySelector(".bar");
    var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches, tick = false;
    function draw() { tick = false;
      var h = hero.offsetHeight || 1, t = Math.min(1, Math.max(0, scrollY / h));
      bar.classList.toggle("solid", scrollY > h - 70);
      if (innerWidth < 900 && !still) { img.style.transform = "scale(" + (1 + t * 0.9).toFixed(3) + ")"; img.style.opacity = (1 - t * t).toFixed(3); }
      else { img.style.transform = ""; img.style.opacity = ""; }
    }
    addEventListener("scroll", function () { if (!tick) { tick = true; requestAnimationFrame(draw); } }, { passive: true });
    draw();
  })();
  $("aw").addEventListener("submit", function (e) {
    e.preventDefault();
    var em = $("awEmail").value.trim();
    if (!EMAIL_OK.test(em)) { tell("That email doesn't look right."); $("awEmail").focus(); return; }
    $("awBtn").disabled = true; tell("");
    S.api("artist-waitlist", { email: em, hp: $("awHp").value })
      .then(function () { $("aw").hidden = true; $("done").hidden = false; $("done").scrollIntoView({ block: "center" }); })
      .catch(function (err) { $("awBtn").disabled = false; tell(err.status ? (err.message || "Couldn't save that. Try again.") : "No signal. Try again in a sec."); });
  });
})();
