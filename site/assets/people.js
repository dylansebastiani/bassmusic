/* People page. One list per kind of person, each row saying where they came from and whose they are.
   Read-only. Uses the Staff page's sign-in (the token it leaves on this device). */
(function () {
  var S = window.Stack, C = S.C, esc = S.esc, $ = function (id) { return document.getElementById(id); };
  var tok = null; try { tok = localStorage.getItem("stack_admin"); } catch (e) {}
  var data = null, tab = "today";
  var day = function (s) { if (!s) return ""; var d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  var usd = function (n) { return n ? "$" + Number(n).toFixed(2) : ""; };
  function who(r) { return '<td class="who"><b>' + esc(r.name || r.full_name || "(no name)") + "</b><span>" + esc(r.email || "") + (r.phone ? " · " + esc(r.phone) : "") + "</span></td>"; }
  function tag(t, hot) { return t ? '<span class="tag' + (hot ? " hot" : "") + '">' + esc(t) + "</span>" : ""; }
  function td(v, cls) { return "<td" + (cls ? ' class="' + cls + '"' : "") + ">" + esc(v == null ? "" : v) + "</td>"; }

  // Each tab: its label, a one-line "what this is", table columns, and the same columns for the export file.
  var TABS = {
    fans: { label: "Fans", what: "Everyone on the member list. \"Came from\" is how they joined. \"Whose\" is the promoter whose show brought them in, or Subduction.",
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
      csv: ["name", "full_name", "email", "phone", "from", "when"] },
    referrals: { label: "Referral credit", what: "Credit owed when a referred promoter runs a show. Pending is still owed. Paid means it was marked settled in the promoter dashboard. This list does not send money.",
      head: ["Referrer", "Referred crew", "Show", "Paid tickets", "Buyer fee", "Credit", "Status", "Updated"],
      row: function (r) { return who(r) + td(r.referred) + td(r.show) + td(r.tickets, "num") + td(usd(r.fee), "num") + td(usd(r.credit), "num") + "<td>" + tag(r.status, r.status === "Pending") + "</td>" + td(day(r.when), "dim num"); },
      csv: ["name", "email", "referred", "show", "tickets", "fee", "credit", "status", "note", "when"] },
    leads: { label: "Demo leads", what: "Promoters who took the test ticket demo. Call or email the ones who finished it first.",
      head: ["Crew", "Full name", "How far they got", "Signed up"],
      row: function (r) { return who(r) + td(r.full_name) + "<td>" + tag(r.status, r.status === "Finished the demo") + "</td>" + td(day(r.when), "dim num"); },
      csv: ["name", "full_name", "email", "phone", "status", "from", "when"] }
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
    var seen = {}; (Array.isArray(data[tab]) ? data[tab] : []).forEach(function (r) { if (r.belongs_to) seen[r.belongs_to] = 1; });
    var names = Object.keys(seen).sort();
    $("own").innerHTML = '<option value="">Everyone\'s</option>' + names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    $("own").hidden = names.length < 1;
  }
  // ---------- Today: money, upcoming shows, and what needs a person ----------
  var money = function (n) { return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
  var showDay = function (s) { var d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
  function todo() {
    var c = (data.today && data.today.counts) || {}, n = function (k) { return c[k] == null ? 0 : c[k]; };
    // [count, said for one, said for more, where it goes]. Only lines with something in them show.
    return [
      [n("leads_finished"), "promoter finished the demo this month. Call them.", "promoters finished the demo this month. Call them.", "leads"],
      [n("leads_new"), "new demo signup this week", "new demo signups this week", "leads"],
      [n("promoters_no_stripe"), "promoter has not connected Stripe yet", "promoters have not connected Stripe yet", "promoters"],
      [n("promoters_no_show"), "promoter has no show yet", "promoters have no show yet", "promoters"],
      [n("referrals_owed"), "referral credit still owed", "referral credits still owed", "referrals"],
      [n("listings_waiting"), "show listing is waiting for review", "show listings are waiting for review", "@shows-review.html"],
      [n("waitlist_new"), "artist joined the waitlist this week", "artists joined the waitlist this week", "waitlist"],
      [n("emails_failed"), "email failed to send this week", "emails failed to send this week", null],
      [n("emails_stuck"), "email is stuck in the queue over an hour", "emails are stuck in the queue over an hour", null]
    ].filter(function (x) { return x[0] > 0; }).map(function (x) { return [x[0], x[0] === 1 ? x[1] : x[2], x[3]]; });
  }
  function drawToday() {
    var t = data.today;
    if (!t) { $("today").innerHTML = '<p class="empty">Today needs the latest owner update. Everything else below still works.</p>'; return; }
    var w = t.money[0], mo = t.money[1] || t.money[0];
        // Hero: the month's fees, poster size. Then the week and the volume behind it.
    var hero = '<section class="hero"><p class="lab">' + "Your fees · last " + mo.days + " days</p>" +
      '<b class="big">' + money(mo.fees) + "</b>" +
      '<div class="strip">' +
        '<div><b>' + money(w.fees) + "</b><span>" + w.days + "-day fees</span></div>" +
        '<div><b>' + money(mo.gross) + "</b><span>" + mo.days + "-day sales</span></div>" +
        '<div><b>' + mo.tickets.toLocaleString() + "</b><span>" + mo.days + "-day tickets</span></div>" +
      "</div></section>";
    var list = todo();
    var needs = list.length ? list.map(function (x, i) {
      var go = x[2], href = go && go.charAt(0) === "@" ? go.slice(1) : null;
      var inner = '<b class="nb">' + x[0].toLocaleString() + "</b><span>" + esc(x[1]) + "</span>" + (go ? '<i aria-hidden="true">→</i>' : "");
      var cls = "need" + (i === 0 ? " top" : "") + (go ? "" : " warn");
      return href ? '<a class="' + cls + '" href="' + esc(href) + '">' + inner + "</a>"
        : go ? '<button type="button" class="' + cls + '" data-go="' + go + '">' + inner + "</button>"
        : '<div class="' + cls + '">' + inner + "</div>";
    }).join("") : '<p class="clear">Nothing needs you right now.</p>';
    var most = Math.max.apply(null, [1].concat(t.upcoming.map(function (e) { return e.tickets; })));
    var up = t.upcoming.length ? t.upcoming.map(function (e) {
      var d = new Date(e.starts_at), ok = !isNaN(d);
      return '<a class="show" href="admin.html#shows" title="Open in Staff">' +
        '<span class="cal"><small>' + (ok ? esc(d.toLocaleDateString(undefined, { month: "short" })) : "") + "</small><b>" + (ok ? d.getDate() : "") + "</b><small>" + (ok ? esc(d.toLocaleDateString(undefined, { weekday: "short" })) : "") + "</small></span>" +
        '<span class="n"><b>' + esc(e.name) + "</b><span>" + esc([e.city, e.belongs_to].filter(Boolean).join(" · ")) + "</span>" +
        '<span class="bar"><i style="width:' + Math.round(100 * e.tickets / most) + '%"></i></span></span>' +
        '<span class="k"><b>' + e.tickets.toLocaleString() + "</b><span" + (e.last7 ? ' class="up"' : "") + ">" + (e.last7 ? "+" + e.last7 + " this week" : "sold") + "</span></span></a>";
    }).join("") : '<p class="clear">No upcoming shows.</p>';
    $("today").innerHTML = hero +
      '<h2 class="sec">Needs <em>you.</em>' + (list.length ? '<span class="cnt">' + list.length + "</span>" : "") + "</h2>" +
      '<div class="needs">' + needs + "</div>" +
      '<h2 class="sec">On <em>sale.</em></h2><div class="shows">' + up + "</div>" +
      '<p class="fine">Fees are the buyer fee on paid orders. Ticket money goes straight to each promoter\'s own Stripe.</p>';
  }
  $("today").addEventListener("click", function (e) { var b = e.target.closest("[data-go]"); if (b) { tab = b.getAttribute("data-go"); $("q").value = ""; tabs(); owners(); draw(); scrollTo(0, 0); } });

  function draw() {
    var isToday = tab === "today";
    $("today").hidden = !isToday; $("list").hidden = isToday;
    if (isToday) return drawToday();
    var T = TABS[tab], list = rows(), all = (data[tab] || []).length;
    $("what").textContent = T.what;
    var noun = tab === "referrals" ? (all === 1 ? " credit" : " credits") : (all === 1 ? " person" : " people");
    $("count").textContent = list.length === all ? all + noun : list.length + " of " + all;
    $("t").innerHTML = "<thead><tr>" + T.head.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>" +
      (list.length ? list.map(function (r) { return "<tr>" + T.row(r) + "</tr>"; }).join("") : '<tr><td class="empty" colspan="' + T.head.length + '">Nobody here yet.</td></tr>') + "</tbody>";
  }
  function tabs() {
    $("tabs").innerHTML = '<button type="button" role="tab" data-k="today" aria-selected="' + (tab === "today") + '">Today</button>' + Object.keys(TABS).map(function (k) { return '<button type="button" role="tab" data-k="' + k + '" aria-selected="' + (k === tab) + '">' + TABS[k].label + "<b>" + (data[k] || []).length + "</b></button>"; }).join("");
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
