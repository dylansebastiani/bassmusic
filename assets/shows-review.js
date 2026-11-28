/* Approval page for one directory submission. The link in Dylan's email carries the token.
   Opening the link does not approve anything. The buttons do. A staff session from /admin can see the queue. */
(function () {
  var C = window.STACK || {};
  var FN = (C.supabaseUrl || "") + "/functions/v1/directory";
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var key = q.get("k") || "";
  var tok = "";
  try { tok = localStorage.getItem("stack_admin") || ""; } catch (e) {}

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function say(t) { $("msg").textContent = t || ""; }
  function block(s, extra) {
    var img = s.flyer ? '<img class="flyer" src="' + esc(s.flyer) + '" alt="">' : "";
    var where = [s.venue, s.city, s.state].filter(Boolean).join(", ") + (s.venue_secret ? " (shown publicly as Secret location)" : "");
    var buttons = s.status === "pending"
      ? '<div class="row"><button type="button" class="btn" data-act="approve" data-v="' + esc(s.updated_at || "") + '"' + extra + '>Put it on the list</button><button type="button" class="btn ghost" data-act="reject" data-v="' + esc(s.updated_at || "") + '"' + extra + ">Leave it off</button></div>"
      : "<p class=\"fine\">" + (s.status === "approved" ? "It's on the list." : "Left off.") + "</p>";
    var more = [];
    if (s.was_live) more.push("Edited after it went live");
    if (s.lineup) more.push("Lineup: " + s.lineup);
    if (s.price) more.push("Price: " + s.price);
    if (s.sounds && s.sounds.length) more.push("Sound: " + s.sounds.join(", "));
    if (s.age) more.push("Age: " + s.age);
    if (s.artist_socials) more.push("Artist socials: " + s.artist_socials);
    if (s.promoter_ig) more.push("Promoter IG: @" + s.promoter_ig);
    if (s.venue_secret && s.secret_reveal_at) more.push("Reveal: " + s.secret_reveal_at);
    if (!s.flyer) more.push("No flyer yet");
    var details = more.map(function (t) { return '<p class="fine">' + esc(t) + "</p>"; }).join("");
    var tag = '<p class="fine">Status: ' + esc(s.status === "pending" ? "In review" : s.status === "approved" ? "Live" : "Left off") + "</p>";
    return '<article class="review"><h2>' + esc(s.name) + "</h2>" + tag + img +
      "<p>" + esc(s.when || "") + "</p><p>" + esc(where) + "</p>" +
      (s.ticket_url ? '<p><a href="' + esc(s.ticket_url) + '" target="_blank" rel="noopener noreferrer">Ticket link</a></p>' : "") +
      (s.email ? "<p class=\"fine\">" + esc(s.email) + "</p>" : "") + details + buttons + "</article>";
  }
  function post(body) {
    var headers = { "Content-Type": "application/json" };
    if (tok && body.id) headers["x-admin-token"] = tok;
    return fetch(FN, { method: "POST", headers: headers, body: JSON.stringify(body) }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Couldn't save that. Try again."); return j; });
    });
  }
  function wire(root) {
    root.querySelectorAll("button[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var body = { a: b.getAttribute("data-act") };
        if (b.getAttribute("data-id")) body.id = b.getAttribute("data-id");
        else body.k = key;
        body.updated_at = b.getAttribute("data-v") || "";
        b.disabled = true;
        post(body).then(function () { load(); }).catch(function (err) { say(err.message); b.disabled = false; });
      });
    });
  }
  function load() {
    var jobs = [];
    if (/^[0-9a-f]{64}$/.test(key)) jobs.push(fetch(FN + "?a=review&k=" + encodeURIComponent(key)).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Not found"); return j; }); }));
    else jobs.push(Promise.resolve(null));
    if (/^[0-9a-f]{64}$/.test(tok)) {
      jobs.push(fetch(FN + "?a=pending", { headers: { "x-admin-token": tok } }).then(function (r) { return r.ok ? r.json() : { pending: [] }; }).catch(function () { return { pending: [] }; }));
    } else jobs.push(Promise.resolve(null));
    Promise.all(jobs).then(function (pair) {
      var one = pair[0] && pair[0].show;
      var pending = pair[1] && pair[1].pending;
      if (one) { $("one").innerHTML = block(one, ""); wire($("one")); }
      else if (!key) $("one").innerHTML = "";
      if (pending) {
        var rest = pending.filter(function (s) { return !one || s.id !== one.id; });
        $("queue").innerHTML = rest.length ? '<div class="queue">' + rest.map(function (s) { return block(s, ' data-id="' + esc(s.id) + '"'); }).join("") + "</div>" : "";
        wire($("queue"));
      }
      if (!one && !(pending && pending.length)) say(key ? "That link is not a waiting show." : "Open the link from the email. Sign in on the staff page, then come back, to see every one that's waiting.");
      else say("");
    }).catch(function () { say("That link is not a waiting show."); });
  }
  load();
})();
