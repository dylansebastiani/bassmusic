/* Door offline mode. While there is signal the door phone keeps a copy of the show's list.
   If the signal drops, scans and check-ins are checked against that copy, saved on the phone,
   and sent to the server as soon as the signal is back. Online, nothing here changes how the door works.
   The server turns this on (me.offline). When it's off, the phone forgets the list. */
(function () {
  function DoorOffline(slug, store) {
    store = store || (function () { try { return window.localStorage; } catch (e) { return null; } })();
    var LKEY = "stack_door_list_" + slug, QKEY = "stack_door_queue_" + slug, MKEY = "stack_door_me_" + slug, CKEY = "stack_door_clash_" + slug;
    var get = function (k, d) { try { var v = store && store.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
    var put = function (k, v) { try { store && store.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    var del = function (k) { try { store && store.removeItem(k); } catch (e) {} };

    var list = get(LKEY, null), queue = get(QKEY, []), clashes = get(CKEY, []), seen = {};
    var byH = {}, byCode = {}, byId = {}, typeById = {}, scanAt = {};
    // Check-ins the phone has seen succeed online since the last list download, so a dropped signal
    // right after doesn't let the same ticket in twice from this phone.
    function index() {
      byH = {}; byCode = {}; byId = {}; typeById = {}; scanAt = {};
      if (!list) return;
      list.scans.forEach(function (s) { scanAt[s.ticket_id + "|" + s.night_id] = s.scanned_at; });
      list.types.forEach(function (t) { typeById[t.id] = t; });
      list.tickets.forEach(function (t) { byH[t.h] = t; byCode[t.code] = t; byId[t.id] = t; });
    }
    index();

    function k(tid, nid) { return tid + "|" + nid; }
    // When this ticket got in on this night, as far as this phone knows (list, live scans it saw, its own saved ones).
    function inAt(tid, nid) {
      var key = k(tid, nid);
      for (var i = 0; i < queue.length; i++) if (k(queue[i].ticket_id, queue[i].night) === key) return queue[i].at;
      if (seen[key]) return seen[key];
      return scanAt[key] || null;
    }
    function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
    function hash(s) {
      var c = (typeof crypto !== "undefined" && crypto.subtle) ? crypto : null;
      if (!c) return Promise.resolve(null);
      return c.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (b) { return hex(b).slice(0, 32); });
    }
    // Same reading as the server: the ticket link or bare 48-hex token from the QR, or the 8-character code.
    function lookup(q) {
      q = String(q || "").trim();
      var m = q.match(/[?&]t=([0-9a-f]{48})/i) || q.match(/^([0-9a-f]{48})$/i);
      if (m) return hash(m[1].toLowerCase()).then(function (h) { return (h && byH[h]) || null; });
      var code = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
      return Promise.resolve(code.length === 8 ? byCode[code] || null : null);
    }
    function base(t) { var ty = typeById[t.type]; return { name: t.name, type: ty ? ty.name : "", comp: t.comp, list: t.list, ticket_id: t.id }; }
    function nightLabels(t) {
      var ty = typeById[t.type], ids = ty ? ty.night_ids : [];
      return list.nights.filter(function (n) { return ids.indexOf(n.id) >= 0; }).map(function (n) { return n.label; }).join(" + ");
    }
    function judge(t, nid, onlineTried) {
      var b = base(t), ty = typeById[t.type];
      b.offline = true;
      if (t.status !== "valid") { b.result = "void"; return b; }
      if (!ty || ty.night_ids.indexOf(nid) < 0) { b.result = "wrong_night"; b.good_for = nightLabels(t); return b; }
      var at = inAt(t.id, nid);
      if (at) { b.result = "used"; b.scanned_at = at; return b; }
      var now = new Date().toISOString();
      queue.push({ key: t.id.slice(0, 8) + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ticket_id: t.id, night: nid, at: now, online: !!onlineTried });
      put(QKEY, queue);
      b.result = "ok"; return b;
    }

    var api = {
      // Ready = there's a list on this phone to check against.
      ready: function () { return !!(list && list.tickets); },
      listAt: function () { return list ? list.at : null; },
      size: function () { return list ? list.tickets.length : 0; },
      pending: function () { return queue.length; },
      clashes: function () { return clashes.slice(); },
      clearClashes: function () { clashes = []; del(CKEY); },
      cachedMe: function () { return get(MKEY, null); },
      saveMe: function (me) { put(MKEY, me); },
      // Fresh list from the server. Live scans it already knows about replace what this phone saw.
      setList: function (d) {
        list = { at: d.at, nights: d.nights || [], types: d.types || [], tickets: d.tickets || [], scans: d.scans || [] };
        seen = {}; index();
        return put(LKEY, list);
      },
      // Offline turned off on the server: forget everything except check-ins still waiting to send.
      forget: function () { list = null; seen = {}; index(); del(LKEY); del(MKEY); },
      // A live answer from the server (scan or check-in): remember who got in, so the copy stays current.
      noteLive: function (r, nid) {
        if (r && r.ticket_id && (r.result === "ok" || r.result === "used")) seen[k(r.ticket_id, nid)] = r.scanned_at || new Date().toISOString();
        if (r && r.result === "undone" && r.ticket_id) {
          delete seen[k(r.ticket_id, nid)];
          delete scanAt[k(r.ticket_id, nid)];
        }
      },
      // A scan with no signal. Resolves with the same shape the server sends, plus offline: true.
      scan: function (q, nid, onlineTried) {
        return lookup(q).then(function (t) { return t ? judge(t, nid, onlineTried) : { result: "not_found", offline: true }; });
      },
      // Is this scan a ticket this phone already let in but hasn't sent yet? Then it's Used, even online.
      queued: function (q, nid) {
        if (!queue.length) return Promise.resolve(null);
        return lookup(q).then(function (t) {
          if (!t) return null;
          for (var i = 0; i < queue.length; i++) if (queue[i].ticket_id === t.id && queue[i].night === nid) {
            var b = base(t); b.result = "used"; b.scanned_at = queue[i].at; b.offline = true; return b;
          }
          return null;
        });
      },
      checkin: function (tid, nid, onlineTried) {
        var t = byId[tid];
        return Promise.resolve(t ? judge(t, nid, onlineTried) : { result: "not_found", offline: true });
      },
      // Undo with no signal works only for a check-in still waiting on this phone.
      undo: function (tid, nid) {
        var before = queue.length;
        queue = queue.filter(function (x) { return !(x.ticket_id === tid && x.night === nid); });
        if (queue.length === before) return false;
        put(QKEY, queue); return true;
      },
      // Find tab with no signal: same rows the server sends, from the copy on this phone.
      search: function (q, nid) {
        if (!list) return [];
        q = String(q || "").trim().toLowerCase();
        var rows = list.tickets.filter(function (t) {
          var ty = typeById[t.type];
          if (t.status === "void" || !ty || ty.night_ids.indexOf(nid) < 0) return false;
          return !q || String(t.name || "").toLowerCase().indexOf(q) >= 0 || String(t.code).toLowerCase().indexOf(q) >= 0;
        });
        rows.sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
        return rows.slice(0, q ? 60 : 3000).map(function (t) {
          var b = base(t); return { ticket_id: t.id, code: t.code, name: t.name, email: null, type: b.type, comp: t.comp, list: t.list, status: t.status, in_at: inAt(t.id, nid) };
        });
      },
      count: function (nid) {
        if (!list) return null;
        var expected = 0, comps = 0, inside = 0;
        list.tickets.forEach(function (t) {
          var ty = typeById[t.type];
          if (t.status !== "valid" || !ty || ty.night_ids.indexOf(nid) < 0) return;
          expected++; if (t.comp) comps++;
          if (inAt(t.id, nid)) inside++;
        });
        return { expected: expected, comps: comps, inside: inside };
      },
      // Send saved check-ins, 100 at a time. send(body) posts to the door's sync action.
      // A clash (someone already in, or the ticket was voided meanwhile) is kept to show the door.
      sync: function (send) {
        if (!queue.length) return Promise.resolve(0);
        var batch = queue.slice(0, 100);
        return send({ scans: batch }).then(function (r) {
          var done = {}, sent = 0;
          (r.results || []).forEach(function (x) {
            var item = null;
            for (var i = 0; i < batch.length; i++) if (batch[i].key === x.key) item = batch[i];
            if (!item) return;
            done[x.key] = 1; sent++;
            if (x.result === "ok") { seen[k(item.ticket_id, item.night)] = item.at; return; }
            // The live scan reached the server just before the phone gave up on it: same check-in, not a clash.
            if (x.result === "used" && item.online && x.scanned_at && Math.abs(Date.parse(x.scanned_at) - Date.parse(item.at)) < 120000) return;
            clashes.push({ name: x.name || "", result: x.result, at: item.at, first_at: x.scanned_at || null });
          });
          queue = queue.filter(function (x) { return !done[x.key]; });
          put(QKEY, queue); put(CKEY, clashes);
          return sent;
        });
      }
    };
    return api;
  }
  if (typeof window !== "undefined") window.DoorOffline = DoorOffline;
  if (typeof module !== "undefined") module.exports = DoorOffline;
})();
