/* Fan show cards, shared by My account and My collection.
   Draws the next show (flyer, countdown, tickets, calendar, bring a friend), the other upcoming shows, and
   stubs for shows already played. Reads only what the account function returns: public show facts and the
   fan's own ticket links. Never a venue name or address. */
(function () {
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var TZ = "America/Chicago", DAY = 86400000;
  function ymd(d) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }
  function dayDiff(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY); }
  function stubDate(iso) {
    try { return new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }); } catch (e) { return ""; }
  }
  // "41 days", "Tomorrow", "Tonight", "6h 12m", or "On now". Times are the show's own (Chicago).
  function countdown(g, now) {
    if (!g.when) return null;
    var start = Date.parse(g.when), end = Date.parse(g.ends || g.when) + 8 * 3600e3;
    if (now >= start && now <= end) return { big: "On now", small: "See you inside" };
    var ms = start - now;
    if (ms > 0 && ms < 12 * 3600e3) { var h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60000); return { big: (h ? h + "h " : "") + m + "m", small: "Until doors" }; }
    var d = dayDiff(ymd(new Date(now)), ymd(new Date(start)));
    if (d <= 0) return { big: "Tonight", small: "Doors soon" };
    if (d === 1) return { big: "Tomorrow", small: "Get ready" };
    return { big: String(d), small: d === 1 ? "day to go" : "days to go" };
  }
  function place(g) { return [g.nights && g.nights.join(" + "), g.city].filter(Boolean).join(" · "); }
  function ticketRows(g, signinUrl) {
    if (!g.tickets || !g.tickets.length) return signinUrl ? '<a class="fx-open ghost" href="' + esc(signinUrl) + '">Sign in to open your ticket</a>' : "";
    return g.tickets.map(function (t) {
      return '<a class="fx-open" href="' + esc(t.url) + '"><span>' + esc(t.type) + ' <i>' + esc(t.code) + "</i></span><b>Open ticket</b></a>";
    }).join("");
  }
  function next(g, i, opts) {
    var c = countdown(g, Date.now());
    return '<article class="fx-next">' +
      (g.image ? '<a href="' + esc(g.link) + '" class="fx-art"><img src="' + esc(g.image) + '" alt="' + esc(g.show) + ' flyer" decoding="async"></a>' : '<div class="fx-art fx-blank" aria-hidden="true"></div>') +
      '<div class="fx-body"><p class="fx-kick">Your next show</p><h2 class="fx-name">' + esc(g.show) + "</h2>" +
      (c ? '<div class="fx-count" data-count="' + i + '"><b>' + esc(c.big) + "</b><span>" + esc(c.small) + "</span></div>" : "") +
      '<p class="fx-when">' + esc(place(g)) + "</p>" + (g.secret ? '<p class="fx-tag">Secret location. It comes by email before the show.</p>' : "") +
      '<div class="fx-tix">' + ticketRows(g, opts.signin) + "</div>" +
      '<div class="fx-tools"><button type="button" data-fx-cal="' + i + '">Add to calendar</button><button type="button" data-fx-share="' + i + '">Bring a friend</button></div>' +
      "</div></article>";
  }
  function later(g, i, opts) {
    return '<article class="fx-later">' + (g.image ? '<img src="' + esc(g.image) + '" alt="" loading="lazy">' : '<span class="fx-blank" aria-hidden="true"></span>') +
      '<div><h3>' + esc(g.show) + '</h3><p class="fx-when">' + esc(place(g)) + "</p>" + ticketRows(g, opts.signin) +
      '<div class="fx-tools"><button type="button" data-fx-cal="' + i + '">Calendar</button><button type="button" data-fx-share="' + i + '">Share</button></div></div></article>';
  }
  function stub(g) {
    return '<article class="fx-stub">' + (g.image ? '<img src="' + esc(g.image) + '" alt="" loading="lazy">' : '<span class="fx-blank" aria-hidden="true"></span>') +
      '<div><p class="fx-was">' + (g.went ? "You were there" : "Your ticket") + "</p><h3>" + esc(g.show) + "</h3>" +
      '<p class="fx-when">' + esc([stubDate(g.when), g.city].filter(Boolean).join(" · ")) + "</p></div></article>";
  }

  // Calendar file: one event per night, public facts only.
  function icsEsc(t) { return String(t == null ? "" : t).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,"); }
  function stamp(ms) { return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""); }
  function ics(g) {
    var starts = (g.starts && g.starts.length ? g.starts : [g.when]).filter(Boolean);
    var where = [g.secret ? "Secret location" : "", g.city].filter(Boolean).join(", ");
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Subduction//My shows//EN", "CALSCALE:GREGORIAN"];
    starts.forEach(function (s, i) {
      var t = Date.parse(s); if (!t) return;
      L.push("BEGIN:VEVENT", "UID:" + String(g.show).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + i + "-" + stamp(t) + "@subduction.art",
        "DTSTAMP:" + stamp(Date.now()), "DTSTART:" + stamp(t), "DTEND:" + stamp(t + 6 * 3600e3), "SUMMARY:" + icsEsc(g.show),
        "LOCATION:" + icsEsc(where), "URL:" + (g.link || ""), "DESCRIPTION:" + icsEsc("Your ticket is in your email and at subduction.art/me"),
        "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc(g.show + " is tomorrow"), "END:VALARM", "END:VEVENT");
    });
    L.push("END:VCALENDAR");
    return L.join("\r\n") + "\r\n";
  }
  function addCal(g) {
    var blob = new Blob([ics(g)], { type: "text/calendar;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = String(g.show).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + ".ics";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function share(g, btn) {
    var text = "I'm going to " + g.show + ". Come with me.";
    if (navigator.share) { navigator.share({ title: g.show, text: text, url: g.link }).catch(function () {}); return; }
    var done = function () { var o = btn.textContent; btn.textContent = "Link copied"; setTimeout(function () { btn.textContent = o; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(text + " " + g.link).then(done, function () {});
  }

  // Draws everything into `root`. opts.signin: where to send someone whose tickets are hidden (member-key session).
  // opts.past: also draw stubs (into opts.pastRoot when given). opts.compact: only the next show, plus a link to the rest.
  function draw(root, groups, opts) {
    opts = opts || {};
    var up = (groups || []).filter(function (g) { return !g.past; }), past = (groups || []).filter(function (g) { return g.past; }).reverse();
    var h = "";
    if (up.length) {
      h += next(up[0], 0, opts);
      if (up.length > 1 && opts.compact) h += '<a class="fx-more" href="/me.html">' + (up.length - 1) + " more " + (up.length === 2 ? "show" : "shows") + " in My account</a>";
      else if (up.length > 1) h += '<p class="fx-h">Also going</p>' + up.slice(1).map(function (g, i) { return later(g, i + 1, opts); }).join("");
    }
    var s = past.length && opts.past !== false ? '<p class="fx-h">Shows you\'ve been to</p><div class="fx-stubs">' + past.map(stub).join("") + "</div>" : "";
    if (opts.pastRoot) opts.pastRoot.innerHTML = s; else h += s;
    root.innerHTML = h;
    root.onclick = function (e) {
      var c = e.target.closest("[data-fx-cal]"), sh = e.target.closest("[data-fx-share]");
      if (c) addCal(up[Number(c.getAttribute("data-fx-cal"))]);
      if (sh) share(up[Number(sh.getAttribute("data-fx-share"))], sh);
    };
    clearInterval(draw.t);
    if (up.length) draw.t = setInterval(function () {
      var el = root.querySelector("[data-count]"), c = countdown(up[0], Date.now()); if (!el || !c) return;
      el.innerHTML = "<b>" + esc(c.big) + "</b><span>" + esc(c.small) + "</span>";
    }, 30000);
    return { upcoming: up.length, past: past.length };
  }
  var api = { draw: draw, countdown: countdown, ics: ics };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Fan = api;
})();
