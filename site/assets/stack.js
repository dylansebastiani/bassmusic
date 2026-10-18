/* Shared helpers for the member pages (t, collection). Same behaviour as the inline block on / and /in. */
window.Stack = (function () {
  var C = window.STACK || {};
  var FN = (C.supabaseUrl || "") + "/functions/v1";
  var q = new URLSearchParams(location.search);
  var MKEY = "stack_member";

  // Attribution travels with the visitor across pages and survives a reload.
  var KEYS = ["src", "e", "r", "utm_source", "utm_medium", "utm_campaign"];
  var attr = {};
  try { attr = JSON.parse(sessionStorage.getItem("stack_attr") || "{}"); } catch (e) {}
  KEYS.forEach(function (k) { if (q.get(k)) attr[k] = q.get(k).slice(0, 80); });
  try { sessionStorage.setItem("stack_attr", JSON.stringify(attr)); } catch (e) {}

  function variant() {
    var m = document.cookie.match(/(?:^|; )stack_v=([AB])/);
    if (m) return m[1];
    var v = Math.random() < 0.5 ? "A" : "B";
    document.cookie = "stack_v=" + v + "; max-age=31536000; path=/; SameSite=Lax";
    return v;
  }
  function parse(r) {
    return r.json().then(function (j) {
      if (!r.ok) throw Object.assign(new Error(j.error || "request failed"), { status: r.status, body: j });
      return j;
    });
  }
  function api(name, body) {
    return fetch(FN + "/" + name, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), keepalive: true }).then(parse);
  }
  function get(name, params) {
    var u = new URL(FN + "/" + name);
    Object.keys(params || {}).forEach(function (k) { if (params[k] != null) u.searchParams.set(k, params[k]); });
    return fetch(u).then(parse);
  }
  function pageview(path) {
    try {
      var b = JSON.stringify({ path: path, source: attr.src || null, event_slug: attr.e || null, variant: variant() });
      if (navigator.sendBeacon) navigator.sendBeacon(FN + "/pageview", new Blob([b], { type: "application/json" }));
    } catch (e) {}
  }

  // The member key lives on the phone. It never goes in the address bar.
  var UUID = /^[0-9a-f-]{36}$/i;
  function token() {
    var t = q.get("t");
    if (t && UUID.test(t)) {
      remember(t);
      try { var u = new URL(location.href); u.searchParams.delete("t"); u.searchParams.delete("rejoin"); history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (e) {}
      return t;
    }
    try { t = localStorage.getItem(MKEY); } catch (e) { t = null; }
    return t && UUID.test(t) ? t : null;
  }
  function remember(t) { try { localStorage.setItem(MKEY, t); } catch (e) {} }
  function forget() { try { localStorage.removeItem(MKEY); } catch (e) {} }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // Only ever link out to web addresses.
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : null; }
  function fmtDate(s, withTime) {
    try { return new Date(s).toLocaleString(undefined, withTime ? { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" }); } catch (e) { return ""; }
  }
  return { C: C, q: q, attr: attr, variant: variant, api: api, get: get, pageview: pageview, token: token, remember: remember, forget: forget, esc: esc, safeUrl: safeUrl, fmtDate: fmtDate };
})();
