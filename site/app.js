/* Shared helpers for every page. No framework. */
window.Stack = (function () {
  var C = window.STACK || {};
  var FN = (C.supabaseUrl || "") + "/functions/v1";
  var q = new URLSearchParams(location.search);

  // Attribution travels with the visitor across pages and survives a reload.
  var KEYS = ["src", "e", "r", "utm_source", "utm_medium", "utm_campaign"];
  var attr = {};
  try { attr = JSON.parse(sessionStorage.getItem("stack_attr") || "{}"); } catch (e) {}
  KEYS.forEach(function (k) { if (q.get(k)) attr[k] = q.get(k).slice(0, 80); });
  try { sessionStorage.setItem("stack_attr", JSON.stringify(attr)); } catch (e) {}

  // A/B headline variant, fixed per browser.
  function variant() {
    var m = document.cookie.match(/(?:^|; )stack_v=([AB])/);
    if (m) return m[1];
    var v = Math.random() < 0.5 ? "A" : "B";
    document.cookie = "stack_v=" + v + "; max-age=31536000; path=/; SameSite=Lax";
    return v;
  }

  function api(name, body, method) {
    return fetch(FN + "/" + name, {
      method: method || "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      keepalive: true
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || "request failed"), { status: r.status, body: j }); return j; }); });
  }
  function get(name, params) {
    var u = new URL(FN + "/" + name); Object.keys(params || {}).forEach(function (k) { if (params[k] != null) u.searchParams.set(k, params[k]); });
    return fetch(u).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || "request failed"), { status: r.status, body: j }); return j; }); });
  }

  function pageview(path) {
    try {
      var b = JSON.stringify({ path: path, source: attr.src || null, event_slug: attr.e || null, variant: variant() });
      if (navigator.sendBeacon) navigator.sendBeacon(FN + "/pageview", new Blob([b], { type: "application/json" }));
      else api("pageview", JSON.parse(b)).catch(function () {});
    } catch (e) {}
  }

  // Signups that failed to send (bad festival signal) wait here and retry.
  var PENDING = "stack_pending";
  function pendingList() { try { return JSON.parse(localStorage.getItem(PENDING) || "[]"); } catch (e) { return []; } }
  function savePending(p) { var l = pendingList(); l.push(p); try { localStorage.setItem(PENDING, JSON.stringify(l.slice(-20))); } catch (e) {} }
  function flushPending() {
    var l = pendingList(); if (!l.length) return Promise.resolve(null);
    var done = [];
    return l.reduce(function (p, item) {
      return p.then(function () { return api("subscribe", item).then(function (r) { done.push({ item: item, res: r }); }).catch(function (e) { if (e.status && e.status < 500 && e.status !== 429) done.push({ item: item, res: null }); }); });
    }, Promise.resolve()).then(function () {
      var rest = l.filter(function (i) { return !done.some(function (d) { return d.item === i; }); });
      try { localStorage.setItem(PENDING, JSON.stringify(rest)); } catch (e) {}
      var ok = done.filter(function (d) { return d.res; }).pop();
      return ok ? ok.res : null;
    });
  }

  function fill(s, map) { return String(s || "").replace(/\{\{(\w+)\}\}/g, function (_, k) { return map[k] != null ? map[k] : ""; }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  return { C: C, FN: FN, q: q, attr: attr, variant: variant, api: api, get: get, pageview: pageview, savePending: savePending, flushPending: flushPending, pendingList: pendingList, fill: fill, esc: esc };
})();
