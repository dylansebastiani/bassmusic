/* People page. One list per kind of person, each row saying where they came from and whose they are.
   Read-only. Uses the Staff page's sign-in (the token it leaves on this device). */
(function () {
  var S = window.Stack, C = S.C, esc = S.esc, $ = function (id) { return document.getElementById(id); };
  var tok = null; try { tok = localStorage.getItem("stack_admin"); } catch (e) {}
  var data = null, tab = "fans";
  var day = function (s) { if (!s) return ""; var d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  var usd = function (n) { return n ? "$" + Number(n).toFixed(2) : ""; };
  function who(r) { return '<td class="who"><b>' + esc(r.name || r.full_name || "(no name)") + "</b><span>" + esc(r.email || "") + (r.phone ? " · " + esc(r.phone) : "") + "</span></td>"; }
  function tag(t, hot) { return t ? '<span class="tag' + (hot ? " hot" : "") + '">' + esc(t) + "</span>" : ""; }
  function td(v, cls) { return "<td" + (cls ? ' class="' + cls + '"' : "") + ">" + esc(v == null ? "" : v) + "</td>"; }

  // Each tab: its label, a one-line "what this is", table columns, and the same columns for the export file.
  var TABS = {
    fans: { label: "Fans", what: "Everyone on the member list. \"Came from\" is how they joined; \"Whose\" is the promoter whose show brought them in, or Subduction.",
      head: ["Who", "Came from", "Show", "Whose", "Status", "Joined"],
      row: function (r) { return who(r) + td(r.from) + td(r.show, "dim") + td(r.belongs_to) + "<td>" + tag(r.status, r.status === "Confirmed") + "</td>" + td(day(r.when), "dim num"); },
      csv: ["name", "email", "phone", "zip", "from", "show", "belongs_to", "status", "when"] },
    buyers: { label: "Ticket holders", what: "Every order that holds tickets: bought, guest list and artist passes. \"Whose\" is the promoter running that show.",
      head: ["Who", "Type", "Came from", "Show", "Whose", "Tickets", "Paid", "Your fee", "When"],
      row: function (r) { return who(r) + "<td>" + tag(r.kind, r.kind === "Bought") + "</td>" + td(r.from, "dim") + td(r.show) + td(r.belongs_to) + td(r.tickets, "num") + td(usd(r.paid), "num") + td(usd(r.fee), "num") + td(day(r.when), "dim num"); },
      csv: ["name", "email", "phone", "kind", "from", "show", "belongs_to", "tickets", "paid", "fee", "when"] },
    promoters: { label: "Promoters", what: "Every crew selling through Subduction, who is on their account, and whether their own Stripe is connected.",
      head: ["Crew", "People", "Status", "Payouts", "Shows", "Tickets sold", "Show links", "Added"],
      row: function (r) { return who(r) + td(r.people, "dim") + "<td>" + tag(r.status, r.status === "active") + "</td>" + td(r.payouts) + td(r.shows, "num") + td(r.tickets_sold, "num") + td(r.link, "dim") + td(day(r.when), "dim num"); },
      csv: ["name", "email", "people", "status", "payouts", "shows", "tickets_sold", "link", "when"] },
    artists: { label: "Artists", what: "Artists booked on a show and sent an artist pass. \"Whose\" is the promoter who booked them.",
      head: ["Artist", "Show", "Whose", "Guest spots", "Status", "Invited"],
      row: function (r) { return who(r) + td(r.show) + td(r.belongs_to) + td(r.guest_spots, "num") + "<td>" + tag(r.status, r.status === "Claimed pass") + "</td>" + td(day(r.when), "dim num"); },
      csv: ["name", "full_name", "email", "phone", "show", "belongs_to", "guest_spots", "status", "when"] },
    waitlist: { label: "Artist waitlist", what: "Artists who signed up on the artist waitlist page. Email these first when artist pages open.",
      head: ["Artist", "Full name", "Came from", "Signed up"],
      row: function (r) { return who(r) + td(r.full_name) + td(r.from, "dim") + td(day(r.when), "dim num"); },
      csv: ["name", "full_name", "email", "phone", "from", "when"] }
  };

  function rows() {
    var q = $("q").value.trim().toLowerCase(), own = $("own").value;
    return (data[tab] || []).filter(function (r) {
      if (own && r.belongs_to !== own) return false;
      if (!q) return true;
      return Object.keys(r).some(function (k) { return r[k] != null && String(r[k]).toLowerCase().indexOf(q) >= 0; });
    });
  }
  function owners() {
    var seen = {}; (data[tab] || []).forEach(function (r) { if (r.belongs_to) seen[r.belongs_to] = 1; });
    var names = Object.keys(seen).sort();
    $("own").innerHTML = '<option value="">Everyone\'s</option>' + names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    $("own").hidden = names.length < 1;
  }
  function draw() {
    var T = TABS[tab], list = rows(), all = (data[tab] || []).length;
    $("what").textContent = T.what;
    $("count").textContent = list.length === all ? all + (all === 1 ? " person" : " people") : list.length + " of " + all;
    $("t").innerHTML = "<thead><tr>" + T.head.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>" +
      (list.length ? list.map(function (r) { return "<tr>" + T.row(r) + "</tr>"; }).join("") : '<tr><td class="empty" colspan="' + T.head.length + '">Nobody here yet.</td></tr>') + "</tbody>";
  }
  function tabs() {
    $("tabs").innerHTML = Object.keys(TABS).map(function (k) { return '<button type="button" role="tab" data-k="' + k + '" aria-selected="' + (k === tab) + '">' + TABS[k].label + "<b>" + (data[k] || []).length + "</b></button>"; }).join("");
    Array.prototype.forEach.call($("tabs").children, function (b) { b.onclick = function () { tab = b.getAttribute("data-k"); $("q").value = ""; tabs(); owners(); draw(); }; });
  }
  $("q").addEventListener("input", function () { draw(); });
  $("own").addEventListener("change", function () { draw(); });
  $("csv").addEventListener("click", function () {
    var cols = TABS[tab].csv, q = function (v) { var s = v == null ? "" : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var csv = [cols.join(",")].concat(rows().map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(","); })).join("\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "subduction-" + tab + "-" + new Date().toISOString().slice(0, 10) + ".csv"; document.body.appendChild(a); a.click(); a.remove();
  });

  function signIn() { $("msg").innerHTML = 'Sign in on the <a href="admin.html">Staff page</a> first, then come back here.'; }
  if (!tok) return signIn();
  fetch((C.supabaseUrl || "") + "/functions/v1/owner", { headers: { "x-admin-token": tok } })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || "failed"), { status: r.status }); return j; }); })
    .then(function (j) { data = j; $("msg").hidden = true; $("app").hidden = false; tabs(); owners(); draw(); })
    .catch(function (e) { if (e.status === 401) signIn(); else $("msg").textContent = "Couldn't load. Refresh to try again."; });
})();
