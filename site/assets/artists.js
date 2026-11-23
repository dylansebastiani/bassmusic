/* Artist waitlist page: four fields, one button. Saves to the artist waitlist (its own list, separate from fans). */
(function () {
  var S = window.Stack, $ = function (id) { return document.getElementById(id); };
  var EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
  function tell(t) { $("awMsg").textContent = t || ""; }
  S.pageview("/artists");
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
