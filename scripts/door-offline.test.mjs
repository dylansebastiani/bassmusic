// Door offline mode (site/assets/door-offline.js): the phone-side checks, with no browser.
// Also guards that the live path stays as it was and that nothing here reaches T.O.F.T.U.'s ticket pages.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";
// Load it the way the browser does: a plain script that sets window.DoorOffline.
const win = {};
vm.runInNewContext(readFileSync(new URL("../site/assets/door-offline.js", import.meta.url), "utf8"), { window: win, crypto: webcrypto, TextEncoder, Uint8Array, JSON, Date, Math, Promise, String, Array });
const DoorOffline = win.DoorOffline;
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const h = (tok) => createHash("sha256").update(tok).digest("hex").slice(0, 32);
const N1 = "n1", N2 = "n2";
const list = {
  at: new Date().toISOString(),
  nights: [{ id: N1, label: "Fri" }, { id: N2, label: "Sat" }],
  types: [{ id: "t1", name: "Friday", night_ids: [N1] }, { id: "tp", name: "Weekend", night_ids: [N1, N2] }],
  tickets: [
    { id: "a0000000-0000", code: "AAAAAAAA", h: h("a".repeat(48)), name: "Ann", type: "tp", comp: false, list: null, status: "valid" },
    { id: "b0000000-0000", code: "BBBBBBBB", h: h("b".repeat(48)), name: "Bo", type: "t1", comp: true, list: "Mook", status: "valid" },
    { id: "c0000000-0000", code: "CCCCCCCC", h: h("c".repeat(48)), name: "Cy", type: "tp", comp: false, list: null, status: "void" },
    { id: "d0000000-0000", code: "DDDDDDDD", h: h("d".repeat(48)), name: "Di", type: "tp", comp: false, list: null, status: "valid" }],
  scans: [{ ticket_id: "d0000000-0000", night_id: N1, scanned_at: "2027-01-09T03:00:00Z" }],
};
const store = mem(), off = DoorOffline("underground", store);
assert.equal(off.ready(), false);
off.setList(list);
assert.equal(off.ready(), true);
assert.equal((await off.scan("https://subduction.art/ticket.html?t=" + "a".repeat(48), N1)).result, "ok", "QR link matches by hash");
assert.equal((await off.scan("AAAAAAAA", N1)).result, "used", "second scan on the same night is Used");
assert.equal((await off.scan("aaaa-aaaa", N2)).result, "ok", "same pass, other night is fine");
assert.equal((await off.scan("BBBBBBBB", N2)).result, "wrong_night");
assert.equal((await off.scan("CCCCCCCC", N1)).result, "void");
assert.equal((await off.scan("DDDDDDDD", N1)).result, "used", "scanned online before the drop is Used");
assert.equal((await off.scan("ZZZZZZZZ", N1)).result, "not_found");
assert.equal((await off.scan("b".repeat(47), N1)).result, "not_found", "a short token never matches");
assert.equal(off.pending(), 2);
assert.equal(JSON.stringify(off.count(N1)), JSON.stringify({ expected: 3, comps: 1, inside: 2 }));
assert.equal(off.search("", N1).length, 3, "Find lists the night's valid tickets");
assert.equal(off.search("an", N1)[0].in_at !== null, true);
// Saved check-ins survive a reload (a new instance on the same storage).
const again = DoorOffline("underground", store);
assert.equal(again.pending(), 2);
assert.equal((await again.queued("AAAAAAAA", N1)).result, "used", "unsent check-in still blocks a second entry");
assert.equal(again.undo("a0000000-0000", N2), true);
assert.equal(again.undo("d0000000-0000", N1), false, "can't undo offline what the server already has");
// Sync: ok is cleared, a clash is kept for the door, a late live scan from this phone is not a clash.
const queued = JSON.parse(store.getItem("stack_door_queue_underground"));
await again.checkin("b0000000-0000", N1, true);
const q2 = JSON.parse(store.getItem("stack_door_queue_underground"));
const sent = await again.sync(async (body) => {
  assert.equal(body.scans.length, 2);
  return { results: [
    { key: q2[0].key, result: "used", name: "Ann", scanned_at: "2027-01-09T02:00:00Z" },
    { key: q2[1].key, result: "used", name: "Bo", scanned_at: q2[1].at },
  ] };
});
assert.equal(sent, 2); assert.equal(again.pending(), 0);
assert.equal(again.clashes().length, 1); assert.equal(again.clashes()[0].name, "Ann");
assert.equal(queued.length, 1, "after the undo only one was waiting");
// A failed send keeps everything.
await again.checkin("a0000000-0000", N2);
await again.sync(() => Promise.reject(new Error("no signal"))).catch(() => {});
assert.equal(again.pending(), 1);
// Server turns offline off: list and saved sign-in data go, unsent check-ins stay.
again.forget();
assert.equal(again.ready(), false); assert.equal(store.getItem("stack_door_list_underground"), null); assert.equal(again.pending(), 1);
// The stored list never holds a raw ticket token.
assert.doesNotMatch(JSON.stringify(list), /a{48}/);

// Live path: the scan call is unchanged, offline only after a request fails with no server answer.
const door = readFileSync(new URL("../site/assets/door.js", import.meta.url), "utf8");
assert.match(door, /call\("scan", \{ night: n, q: q \}/);
assert.match(door, /var netErr = function \(err\) \{ return offOn && OFF\.ready\(\) && !err\.status; \}/);
assert.match(door, /if \(d\.offline\) \{ offOn = true;/, "offline mode only when the server says so");
assert.match(door, /else \{ offOn = false; OFF\.forget\(\); keepPage\(false\); \}/);
const sw = readFileSync(new URL("../site/door-sw.js", import.meta.url), "utf8");
assert.match(sw, /r\.method !== "GET" \|\| u\.origin !== location\.origin\) return;/, "service worker leaves server calls alone");
assert.match(sw, /fetch\(r\)\.then/, "network first");
// Only the door page uses any of it.
for (const f of ["site/tickets.html", "site/ticket.html", "site/assets/tickets.js", "site/pass.html", "site/admin.html"]) {
  const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
  assert.doesNotMatch(src, /door-offline|door-sw/, f + " must not load door offline code");
}
assert.match(readFileSync(new URL("../site/door.html", import.meta.url), "utf8"), /<script src="assets\/door-offline\.js"><\/script>\n<script src="assets\/door\.js"><\/script>/);
console.log("door offline ok: phone-side checks, sync and clashes, live path unchanged, door page only");
