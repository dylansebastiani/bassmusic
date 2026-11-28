/* People page. One list per kind of person, each row saying where they came from and whose they are.
   Read-only. Uses the Staff page's sign-in (the token it leaves on this device). */
(function () {
  var S = window.Stack, C = S.C, esc = S.esc, $ = function (id) { return document.getElementById(id); };
  var tok = null; try { tok = localStorage.getItem("stack_admin"); } catch (e) {}
  var data = null, tab = "today";
  var day = function (s) { if (!s) return ""; var d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  var usd = function (n) { return n ? "$" + Number(n).toFixed(2) : ""; };
  // Email and phone are tap targets, so a lead is one tap from a call.
  // A mailto link is built only for a plain address. Anything with ? # & spaces or control characters
  // (which could prefill a subject or body) stays plain text.
  var SIMPLE_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  function mail(e) {
    e = String(e);
    return SIMPLE_EMAIL.test(e) ? '<a href="mailto:' + esc(encodeURIComponent(e)) + '">' + esc(e) + "</a>" : esc(e);
  }
  function call(p) {
    var tel = String(p).replace(/[^\d+]/g, "");
    return tel ? '<a href="tel:' + esc(tel) + '">' + esc(p) + "</a>" : esc(p);
  }
  window.PeopleLinks = { mail: mail, call: call };
  function who(r) {
    return '<td class="who"><b>' + esc(r.name || r.full_name || "(no name)") + "</b><span>" +
      (r.email ? mail(r.email) : "") +
      (r.phone ? (r.email ? " · " : "") + call(r.phone) : "") + "</span></td>";
  }
  function tag(t, hot) { return t ? '<span class="tag' + (hot ? " hot" : "") + '">' + esc(t) + "</span>" : ""; }
  function td(v, cls) { return "<td" + (cls ? ' class="' + cls + '"' : "") + ">" + esc(v == null ? "" : v) + "</td>"; }

  // Each tab: its label, a one-line "what this is", table columns, and the same columns for the export file.
  var TABS = {
    shows: { label: "Shows", what: "Every show on Subduction. Tap one for sales by day, ticket types and where the sales came from.",
      head: ["Show", "Date", "Whose", "Tickets", "Sold", "Your fee"],
      row: function (r) { return '<td class="who"><b>' + esc(r.name) + "</b><span>" + esc(r.city || "") + "</span></td>" + td(day(r.starts_at), "dim num") + td(r.belongs_to) + td(r.tickets, "num") + td(usd(r.gross), "num") + td(usd(r.fees), "num"); },
      csv: ["name", "city", "starts_at", "belongs_to", "tickets", "guest_list", "artist_passes", "orders", "gross", "fees", "link"] },
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
        '<div><b>' + money(mo.gross) + "</b><span>" + mo.days + "-day charged</span></div>" +
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
      return '<a class="show" href="admin.html#shows" data-slug="' + esc(e.slug) + '">' +
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
      (list.length ? list.map(function (r, i) { return '<tr data-i="' + i + '" tabindex="0">' + T.row(r) + "</tr>"; }).join("") : '<tr><td class="empty" colspan="' + T.head.length + '">Nobody here yet.</td></tr>') + "</tbody>";
    // On a phone each row becomes a card. Every cell carries its column name for the label.
    Array.prototype.forEach.call($("t").querySelectorAll("tbody tr"), function (tr) {
      Array.prototype.forEach.call(tr.children, function (c, i) { if (T.head[i] && !c.classList.contains("empty")) c.setAttribute("data-l", T.head[i]); });
    });
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

  // ================= Workspaces: tap a row, get the whole picture and the buttons =================
  var shown = [];   // the rows on screen, so a tap finds its record
  var _rows = rows; rows = function () { shown = _rows(); return shown; };
  $("t").addEventListener("click", function (e) { if (e.target.closest("a")) return; var tr = e.target.closest("tr[data-i]"); if (tr) open(tab, shown[+tr.getAttribute("data-i")]); });
  $("t").addEventListener("keydown", function (e) { if (e.key === "Enter") { var tr = e.target.closest("tr[data-i]"); if (tr) open(tab, shown[+tr.getAttribute("data-i")]); } });
  var SITE = (C.siteUrl || "https://subduction.art").replace(/\/$/, "");
  var sheet = null, cur = null;
  function close() { if (!sheet) return; sheet.hidden = true; document.body.classList.remove("locked"); cur = null; }
  var first = function (r) { return r.full_name ? String(r.full_name).split(" ")[0] : (r.name || "there"); };
  var stat = function (v, l) { return "<div><b>" + v + "</b><span>" + esc(l) + "</span></div>"; };
  var btn = function (label, attrs, cls) { return '<button type="button" class="act' + (cls ? " " + cls : "") + '" ' + attrs + ">" + esc(label) + "</button>"; };
  var link = function (label, href, cls) { return '<a class="act' + (cls ? " " + cls : "") + '" href="' + esc(href) + '"' + (/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : "") + ">" + esc(label) + "</a>"; };
  var telOf = function (p) { return p ? String(p).replace(/[^\d+]/g, "") : ""; };

  // Ready-written emails. Short, from Dylan. Edited in the preview before anything sends.
  var DRAFTS = {
    nudge_stripe: function (r) { return { subject: "Connect Stripe so ticket money comes to you", body: "Hey " + first(r) + ",\n\nYour Subduction account is set up. One step left: connect your Stripe so ticket money goes straight to you. It takes about five minutes.\n\nOpen your dashboard here: " + SITE + "/promoter.html\n\nAny trouble, just reply to this email.\n\nDylan" }; },
    pitch: function (r) { return { subject: "Your next show on Subduction", body: "Hey " + first(r) + ",\n\nThanks for trying the test ticket. If you have a show coming up, I'll set up the page with you.\n\nBuyers pay a flat $1.50 per ticket and the money goes straight to your Stripe.\n\nReply with a date and I'll get it moving.\n\nDylan" }; },
    invite: function (r) { return { subject: "You're off the Subduction waitlist", body: "Hey " + first(r) + ",\n\nThanks for joining the artist waitlist. I'd like to get you set up.\n\nReply with your best links (SoundCloud, Instagram, upcoming shows) and I'll take it from there.\n\nDylan" }; },
    custom: function (r) { return { subject: "", body: "Hey " + first(r) + ",\n\n\n\nDylan" }; }
  };
  function acts(email) { return (data.activity && data.activity[String(email || "").toLowerCase()]) || []; }
  var ACT_LABEL = { email: "Emailed", contacted: "Marked contacted", note: "Note", stop: "Asked for no email" };
  function timeline(r) {
    var a = acts(r.email);
    var stop = a.some(function (x) { return x.type === "stop"; });
    return '<h3 class="sh-h">Activity</h3>' +
      (a.length ? '<ol class="tl">' + a.slice(0, 12).map(function (x) {
        return "<li><b>" + esc(ACT_LABEL[x.type] || x.type) + (x.type === "email" && x.ok === false ? " (failed)" : "") + "</b>" + (x.text ? "<span>" + esc(x.text) + "</span>" : "") + "<i>" + esc(day(x.when)) + (x.by ? " · " + esc(x.by.split("@")[0]) : "") + "</i></li>";
      }).join("") + "</ol>" : '<p class="sh-dim">Nothing yet.</p>') +
      (r.email ? '<div class="logrow">' + btn("Mark contacted", 'data-log="contacted"') + btn("Add note", 'data-note') + (stop ? "" : btn("They said stop", 'data-log="stop"', "quiet")) + "</div>" +
        '<form class="noteform" hidden><label class="sr" for="noteT">Note</label><textarea id="noteT" rows="3" maxlength="1000" placeholder="What happened"></textarea><button type="submit" class="act hot">Save note</button></form>' : "");
  }
  function contactActs(r, draftKind) {
    var t = telOf(r.phone), stop = acts(r.email).some(function (x) { return x.type === "stop"; });
    return (r.email && !stop ? btn(draftKind === "custom" ? "Email" : ({ nudge_stripe: "Nudge Stripe", pitch: "Send pitch", invite: "Send invite" })[draftKind], 'data-mail="' + draftKind + '"', "hot") : "") +
      (r.email && draftKind !== "custom" && !stop ? btn("Email", 'data-mail="custom"') : "") +
      (t ? link("Call", "tel:" + t) + link("Text", "sms:" + t) : "") +
      (stop ? '<span class="sh-dim">They asked for no email.</span>' : "");
  }
  function head(kick, name, sub) { return '<p class="sh-k">' + esc(kick) + '</p><h2 class="sh-n">' + esc(name) + "</h2>" + (sub ? '<p class="sh-s">' + sub + "</p>" : ""); }
  function contactLine(r) { return [r.email ? mail(r.email) : "", r.phone ? call(r.phone) : ""].filter(Boolean).join(" · "); }
  function ordersOf(email) { var e = String(email || "").toLowerCase(); return (data.buyers || []).filter(function (b) { return String(b.email || "").toLowerCase() === e; }); }
  function chart(s) {
    // Tickets sold per day, last 30 days. One series, bone bars, value on hover.
    var by = {}; (s.by_day || []).forEach(function (x) { by[x.d] = x.n; });
    var days = [], d = new Date(); d.setHours(12, 0, 0, 0);
    for (var i = 29; i >= 0; i--) { var x = new Date(d.getTime() - i * 864e5), k = x.toISOString().slice(0, 10); days.push({ k: k, n: by[k] || 0, x: x }); }
    var max = Math.max.apply(null, [1].concat(days.map(function (q) { return q.n; }))), tot = days.reduce(function (a, q) { return a + q.n; }, 0);
    return '<h3 class="sh-h">Sales, last 30 days <small>' + tot + " tickets</small></h3>" +
      '<div class="chart" role="img" aria-label="' + tot + ' tickets sold in the last 30 days">' + days.map(function (q) {
        var lab = q.x.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ": " + q.n + (q.n === 1 ? " ticket" : " tickets");
        return '<span class="cb" title="' + esc(lab) + '" data-tip="' + esc(lab) + '"><i style="height:' + (q.n ? Math.max(4, Math.round(100 * q.n / max)) : 0) + '%"></i></span>';
      }).join("") + '</div><div class="chart-ax"><span>' + esc(days[0].x.toLocaleDateString(undefined, { month: "short", day: "numeric" })) + '</span><span class="tip" aria-live="polite"></span><span>Today</span></div>';
  }
  var VIEW = {
    shows: function (s) {
      var up = s.starts_at && new Date(s.ends_at || s.starts_at) > new Date();
      return head((up ? "Upcoming" : "Past") + " · " + day(s.starts_at), s.name, esc([s.city, s.belongs_to].filter(Boolean).join(" · "))) +
        '<div class="sh-stats">' + stat(s.tickets.toLocaleString(), "Tickets sold") + stat(money(s.gross), "Sold") + stat(money(s.fees), "Your fees") + stat(s.guest_list + s.artist_passes, "Guests and artists") + "</div>" +
        '<div class="sh-acts">' + link("Ticket page", "https://" + s.link) + link("Open in Staff", "admin.html#shows") + link("Door app", "door.html?e=" + encodeURIComponent(s.slug)) + "</div>" +
        chart(s) +
        (s.types.length ? '<h3 class="sh-h">Ticket types</h3><div class="types">' + s.types.map(function (t) {
          var pct = t.cap ? Math.min(100, Math.round(100 * t.sold / t.cap)) : 0;
          return '<div class="ty"><div class="ty-t"><b>' + esc(t.name) + "</b><span>" + t.sold + (t.cap ? " / " + t.cap : "") + " sold" + (t.comps ? " · " + t.comps + " guests" : "") + "</span></div>" + (t.cap ? '<div class="meter"><i style="width:' + pct + '%"></i></div>' : "") + "</div>";
        }).join("") + "</div>" : "") +
        (s.from.length ? '<h3 class="sh-h">Where sales came from</h3><div class="from">' + s.from.map(function (f) { return "<div><span>" + esc(f.label) + "</span><b>" + f.n + "</b></div>"; }).join("") + "</div>" : "");
    },
    promoters: function (r) {
      var mine = (data.shows || []).filter(function (s) { return s.belongs_to === r.name; });
      var stripe = r.stripe === "on" ? '<span class="tag hot">Stripe connected</span>' : r.stripe === "legacy" ? '<span class="tag">Original Stripe</span>' : '<span class="tag warn">Stripe not connected</span>';
      return head("Promoter · since " + day(r.when), r.name, contactLine(r) + " " + stripe + ' <span class="tag">' + esc(r.status) + "</span>") +
        '<div class="sh-stats">' + stat(r.shows, "Shows") + stat((r.tickets_sold || 0).toLocaleString(), "Tickets sold") + stat(money(r.gross), "Sold") + stat(money(r.fees), "Your fees") + "</div>" +
        '<div class="sh-acts">' + contactActs(r, r.stripe === "off" ? "nudge_stripe" : "custom") + "</div>" +
        (r.people ? '<h3 class="sh-h">On their account</h3><p class="sh-p">' + esc(r.people) + "</p>" : "") +
        '<h3 class="sh-h">Their shows</h3>' + (mine.length ? '<div class="mini">' + mine.map(function (s) { return '<button type="button" data-show="' + esc(s.slug) + '"><b>' + esc(s.name) + "</b><span>" + esc(day(s.starts_at)) + " · " + s.tickets + " sold</span><i>→</i></button>"; }).join("") + "</div>" : '<p class="sh-dim">No show yet.</p>') +
        timeline(r);
    },
    leads: function (r) {
      var steps = ["Signed up", "Got the ticket", "Opened the ticket", "Finished the demo"], at = steps.indexOf(r.status);
      return head("Demo lead · " + day(r.when), r.name || r.full_name, esc(r.full_name || "") + (r.full_name ? " · " : "") + contactLine(r)) +
        '<ol class="steps">' + steps.map(function (st, i) { return '<li class="' + (i <= at ? "on" : "") + '">' + esc(st) + "</li>"; }).join("") + "</ol>" +
        '<div class="sh-acts">' + contactActs(r, "pitch") + "</div>" + timeline(r);
    },
    waitlist: function (r) {
      return head("Artist waitlist · " + day(r.when), r.name || r.full_name, esc(r.full_name || "") + (r.full_name ? " · " : "") + contactLine(r)) +
        '<div class="sh-acts">' + contactActs(r, "invite") + "</div>" + timeline(r);
    },
    artists: function (r) {
      return head("Artist · " + (r.show || ""), r.name, esc(r.full_name || "") + (r.full_name ? " · " : "") + contactLine(r)) +
        '<div class="sh-stats">' + stat(esc(r.status), "Pass") + stat(r.guest_spots == null ? "0" : r.guest_spots, "Guest spots") + stat(esc(r.belongs_to), "Booked by") + "</div>" +
        '<div class="sh-acts">' + contactActs(r, "custom") + "</div>" + timeline(r);
    },
    fans: function (r) { return person("Fan · joined " + day(r.when), r, '<div class="sh-stats">' + stat(esc(r.from || "Homepage"), "Came from") + stat(esc(r.status), "Status") + stat(esc(r.belongs_to), "Whose") + "</div>"); },
    buyers: function (r) { return person(r.kind + " · " + day(r.when), r, '<div class="sh-stats">' + stat(esc(r.show || ""), "Show") + stat(r.tickets, "Tickets") + stat(money(r.paid), "Paid") + stat(esc(r.from || ""), "Came from") + "</div>"); },
    referrals: function (r) {
      return head("Referral credit · " + r.status, r.name, contactLine(r)) +
        '<div class="sh-stats">' + stat(esc(r.referred), "Brought in") + stat(esc(r.show), "Show") + stat(r.tickets, "Paid tickets") + stat(money(r.credit), "Credit") + "</div>" +
        '<p class="sh-p">Marking it paid happens in the promoter dashboard. This page sends no money.</p>' + '<div class="sh-acts">' + contactActs(r, "custom") + "</div>" + timeline(r);
    }
  };
  function person(kick, r, stats) {
    var os = ordersOf(r.email);
    return head(kick, r.name || r.full_name || "(no name)", contactLine(r)) + stats +
      '<div class="sh-acts">' + contactActs(r, "custom") + "</div>" +
      '<h3 class="sh-h">Tickets</h3>' + (os.length ? '<div class="mini">' + os.map(function (o) { return "<div><b>" + esc(o.show || "") + "</b><span>" + esc(o.kind) + " · " + o.tickets + (o.paid ? " · " + money(o.paid) : "") + " · " + esc(day(o.when)) + "</span></div>"; }).join("") + "</div>" : '<p class="sh-dim">No tickets yet.</p>') +
      timeline(r);
  }
  // The sheet is built on first use, so nothing touches the page until a row is opened.
  function ensureSheet() {
    if (sheet) return;
    sheet = document.createElement("div"); sheet.className = "sheet"; sheet.hidden = true; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true");
    sheet.innerHTML = '<div class="sh-in"><button type="button" class="sh-x" data-x aria-label="Close">Close ✕</button><div id="shBody"></div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener("click", function (e) { if (e.target === sheet || e.target.closest("[data-x]")) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sheet.hidden) close(); });
    $("shBody").addEventListener("click", function (e) {
      var m = e.target.closest("[data-mail]"); if (m) return compose(m.getAttribute("data-mail"));
      var sh = e.target.closest("[data-show]"); if (sh) return openShow(sh.getAttribute("data-show"));
      var lg = e.target.closest("[data-log]");
      if (lg) {
        var k = lg.getAttribute("data-log"), r = cur.r;
        if (k === "stop" && !confirm("Mark " + r.email + " as not wanting email? Sending from here stops for them.")) return;
        lg.disabled = true;
        act({ a: "log", to: r.email, kind: k }).then(function () { remember(r.email, { type: k, text: null }); open(cur.kind, r); flash(ACT_LABEL[k] + "."); })
          .catch(function (err) { lg.disabled = false; flash(err.message); });
        return;
      }
      if (e.target.closest("[data-note]")) { var f = $("shBody").querySelector(".noteform"); f.hidden = false; f.querySelector("textarea").focus(); }
    });
    $("shBody").addEventListener("submit", function (e) {
      var f = e.target.closest(".noteform"); if (!f) return; e.preventDefault();
      var r = cur.r, t = f.querySelector("textarea").value.trim(); if (!t) return;
      act({ a: "log", to: r.email, kind: "note", text: t }).then(function () { remember(r.email, { type: "note", text: t }); open(cur.kind, r); flash("Note saved."); }).catch(function (err) { flash(err.message); });
    });
    $("shBody").addEventListener("mouseover", function (e) { var b = e.target.closest("[data-tip]"); var tip = $("shBody").querySelector(".chart-ax .tip"); if (b && tip) tip.textContent = b.getAttribute("data-tip"); });
  }
  function open(kind, r) {
    if (!r || !VIEW[kind]) return;
    ensureSheet();
    cur = { kind: kind, r: r };
    $("shBody").innerHTML = VIEW[kind](r);
    sheet.hidden = false; document.body.classList.add("locked"); sheet.querySelector(".sh-in").scrollTop = 0;
    sheet.querySelector(".sh-x").focus();
  }
  function openShow(slug) { var s = (data.shows || []).filter(function (x) { return x.slug === slug; })[0]; if (s) open("shows", s); }

  // Compose: the email opens as an editable preview. Nothing sends until Send is pressed.
  function compose(kind) {
    var r = cur.r, d = DRAFTS[kind](r);
    var box = document.createElement("form"); box.className = "compose"; box.noValidate = true;
    box.innerHTML = '<h3 class="sh-h">Email ' + esc(first(r)) + " <small>to " + esc(r.email) + "</small></h3>" +
      '<label for="cSub">Subject</label><input id="cSub" maxlength="140" value="' + esc(d.subject) + '">' +
      '<label for="cBody">Message</label><textarea id="cBody" rows="10" maxlength="4000">' + esc(d.body) + "</textarea>" +
      '<p class="sh-dim">From Dylan @ Subduction. Replies come to your inbox. An unsubscribe line and the mailing address are added at the bottom.</p>' +
      '<div class="sh-acts"><button type="submit" class="act hot">Send now</button>' + btn("Cancel", "data-cancel") + '</div><p class="cmsg" role="status"></p>';
    var old = $("shBody").querySelector(".compose"); if (old) old.remove();
    $("shBody").querySelector(".sh-acts").insertAdjacentElement("afterend", box);
    box.querySelector("#cSub").focus();
    box.querySelector("[data-cancel]").onclick = function () { box.remove(); };
    box.onsubmit = function (e) {
      e.preventDefault();
      var go = box.querySelector("[type=submit]"); go.disabled = true; box.querySelector(".cmsg").textContent = "Sending...";
      act({ a: "send", to: r.email, name: r.full_name || r.name, kind: kind, subject: box.querySelector("#cSub").value, body: box.querySelector("#cBody").value })
        .then(function () { remember(r.email, { type: "email", text: box.querySelector("#cSub").value, ok: true }); open(cur.kind, r); flash("Sent to " + r.email); })
        .catch(function (err) { go.disabled = false; box.querySelector(".cmsg").textContent = err.message; });
    };
  }
  function act(body) {
    return fetch((C.supabaseUrl || "") + "/functions/v1/owner", { method: "POST", headers: { "content-type": "application/json", "x-admin-token": tok }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "Didn't work. Try again."); return j; }); });
  }
  function remember(email, x) {
    var k = String(email).toLowerCase(); data.activity = data.activity || {};
    x.when = new Date().toISOString(); try { x.by = localStorage.getItem("stack_admin_email") || null; } catch (e) {}
    (data.activity[k] = data.activity[k] || []).unshift(x);
  }
  function flash(t) { var f = document.createElement("p"); f.className = "flash"; f.textContent = t; $("shBody").prepend(f); setTimeout(function () { f.remove(); }, 4000); }
  $("today").addEventListener("click", function (e) { var a = e.target.closest("a.show[data-slug]"); if (a) { e.preventDefault(); openShow(a.getAttribute("data-slug")); } });

  function signIn() { $("msg").innerHTML = 'Sign in on the <a href="admin.html">Staff page</a> first, then come back here.'; }
  if (!tok) return signIn();
  fetch((C.supabaseUrl || "") + "/functions/v1/owner", { headers: { "x-admin-token": tok } })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || "failed"), { status: r.status }); return j; }); })
    .then(function (j) { data = j; $("msg").hidden = true; $("app").hidden = false; tabs(); owners(); draw(); })
    .catch(function (e) { if (e.status === 401) signIn(); else $("msg").textContent = "Couldn't load. Refresh to try again."; });
})();
