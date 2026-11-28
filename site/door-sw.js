/* Keeps the door page on the phone so it opens with no signal.
   Network first, always: with signal the phone gets exactly what it gets today.
   The saved copy is used only when the network fails. Only same-site GETs. API calls to the server are never touched. */
var CACHE = "door-v1";
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
// The door page sends the list of its own files to keep (page, scripts, styles, QR reader).
self.addEventListener("message", function (e) {
  var urls = (e.data && e.data.cache) || [];
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(urls.filter(function (u) { return new URL(u).origin === location.origin; }).map(function (u) { return c.add(u).catch(function () {}); }));
  }));
});
self.addEventListener("fetch", function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(r).then(function (res) {
    if (res.ok && res.type === "basic") { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(r, r.mode === "navigate" ? { ignoreSearch: true } : undefined).then(function (m) { return m || Response.error(); });
  }));
});
