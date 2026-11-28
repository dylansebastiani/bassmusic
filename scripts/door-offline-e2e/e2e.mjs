// End-to-end test of door offline mode. Not part of `npm run check` (needs Deno and a browser).
// Runs the real door page (dist/, served on :8080) in headless Chromium at phone size, talking to the real
// door function (run-door.ts on :54329, fake in-memory database). "Signal" is cut by failing the door's requests
// and putting the browser offline. Usage: see README.md in this folder.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const SITE = "http://127.0.0.1:8080", FN = "http://127.0.0.1:54329", LIVE = "https://hxfuelulxsituzcgsvhg.supabase.co/functions/v1/door";
const SLUG = "door-offline-test", SHOTS = process.env.SHOTS || "";
let pass = 0, fail = 0, r = "";
const ok = (c, m) => { if (!c && typeof r !== "undefined") m += "  [last result: " + String(r).replace(/\s+/g, " ") + "]"; if (c) { pass++; console.log("  ok  ", m); } else { fail++; console.log("  FAIL", m); } };
const db = () => fetch(FN + "/__db").then((r) => r.json());
const api = (a, tok, body) => fetch(`${FN}/functions/v1/door?e=${SLUG}&a=${a}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(tok ? { "x-door-token": tok } : {}) }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
let signal = "up", delayMs = 0, doorCalls = [];
await ctx.route(LIVE + "**", async (route) => {
  const req = route.request(), u = new URL(req.url());
  doorCalls.push(u.searchParams.get("a"));
  if (signal === "down") return route.abort("internetdisconnected");
  const res = await fetch(FN + "/functions/v1/door" + u.search, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
  const body = Buffer.from(await res.arrayBuffer());
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body }).catch(() => {});
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = async (n) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${n}.png` }); } };
const result = async () => { await page.waitForSelector("#result:not([hidden])", { timeout: 9000 }); const t = (await page.textContent("#result")).replace("Tap to keep going", "").trim(); await page.click("#result"); return t; };
// The door ignores the same code twice within 4 seconds (camera debounce, unchanged), so a repeat waits it out.
let lastQ = "";
const type = async (q) => { if (q === lastQ) await page.waitForTimeout(4100); lastQ = q; await page.evaluate(() => document.getElementById("mcode").removeAttribute("maxlength")); await page.fill("#mcode", q); await page.click("#mf button"); return result(); };
const off = async (down) => { signal = down ? "down" : "up"; await ctx.setOffline(down); };
const ls = (k) => page.evaluate((k) => localStorage.getItem(k), k);

if (process.argv[2] === "off") {
  console.log("6. offline mode turned off on the server (DOOR_OFFLINE=off): the door is exactly today's door");
  await page.goto(`${SITE}/door.html?e=${SLUG}`);
  // A phone that had offline mode before: a saved list and the saved page.
  await page.evaluate(async (s) => { localStorage.setItem("stack_door_list_" + s, JSON.stringify({ at: "x", nights: [], types: [], tickets: [{ id: "x", code: "OFFTST03", h: "x", type: "x", status: "valid" }], scans: [] })); localStorage.setItem("stack_door_me_" + s, "{}"); await navigator.serviceWorker.register("door-sw.js", { scope: "./door" }); }, SLUG);
  await page.fill("#pin", "4321"); await page.click("#pf button");
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForTimeout(800);
  ok(!(await ls("stack_door_list_" + SLUG)) && !(await ls("stack_door_me_" + SLUG)), "phone forgot the saved list");
  ok((await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))) === 0, "saved page removed (service worker unregistered)");
  ok((await api("offline", (await api("pin", null, { pin: "4321" })).token)).error === "Offline mode is off.", "server refuses the offline list");
  await off(true);
  await page.fill("#mcode", "OFFTST03"); await page.click("#mf button"); await page.waitForTimeout(800);
  ok((await page.textContent("#smsg")).includes("(no signal? use Find by name)") && await page.isHidden("#result"), "no signal: same message as today, no offline answer");
  ok(await page.isHidden("#offbar"), "no offline bar");
  await off(false); lastQ = "OFFTST03";
  r = await type("OFFTST03"); ok(/^In/.test(r) && !r.includes("saved on this phone"), "online scan works as today");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close(); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}

console.log("1. online, offline mode on: the door works exactly as before");
await page.goto(`${SITE}/door.html?e=${SLUG}`);
await page.fill("#pin", "4321"); await page.click("#pf button");
await page.waitForSelector("#app:not([hidden])");
await page.waitForFunction((s) => !!localStorage.getItem("stack_door_list_" + s), SLUG, { timeout: 8000 });
ok(JSON.parse(await ls("stack_door_list_" + SLUG)).tickets.length === 7, "phone downloaded the list (7 tickets)");
ok(!(await ls("stack_door_list_" + SLUG)).includes("a1a1a1a1a1"), "no raw QR secret stored on the phone");
doorCalls = [];
r = await type("OFFTST01");
ok(/^In/.test(r) && r.includes("Alex Night One"), "scan online: In (" + r.replace(/\s+/g, " ") + ")");
ok(doorCalls.filter((a) => a === "scan").length === 1, "a live scan is one server call, same as today");
r = await type("OFFTST01");
ok(/^Used/.test(r), "same ticket again online: Used");
ok(await page.isHidden("#offbar"), "no offline bar while online with nothing waiting");
const other = (await api("pin", null, { pin: "4321" })).token;   // a second door phone
const n1 = (await db()).ticket_nights[0].id;
await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready);
await page.waitForTimeout(800);
ok(await page.evaluate(() => !!navigator.serviceWorker.controller || navigator.serviceWorker.getRegistrations().then((r) => r.length > 0)), "door page saved on the phone (service worker registered)");
await shot("1-online");

console.log("2. signal drops");
await off(true);
await page.evaluate(() => window.dispatchEvent(new Event("offline")));
r = await type("OFFTST03");
ok(/^In/.test(r) && r.includes("saved on this phone"), "offline scan: In, saved on this phone");
await shot("2-offline-in");
r = await type("OFFTST03"); ok(/^Used/.test(r), "same ticket again offline: Used");
r = await type("OFFTST01"); ok(/^Used/.test(r), "ticket already scanned online before the drop: Used");
r = await type("OFFTST02"); ok(/^Wrong night/.test(r) && r.includes("Night 2"), "night 2 ticket on night 1: Wrong night");
r = await type("OFFTST05"); ok(/^Void/.test(r), "void ticket: Void");
r = await type("https://subduction.art/ticket.html?t=" + "d4".repeat(24));
ok(/^In/.test(r) && r.includes("Dee Guest") && r.includes("guest list (Mook)"), "QR ticket link offline: In, guest list shown");
r = await type("ZZZZZZZZ"); ok(/^Not found/.test(r) && r.includes("phone's list"), "unknown code offline: Not found, says it's the phone's list");
await api("scan", other, { night: n1, q: "OFFTST07" });   // the other phone, with signal, lets Gus in
r = await type("OFFTST07"); ok(/^In/.test(r), "ticket the other phone just let in: this offline phone can't know, says In (the known risk)");
await page.waitForTimeout(300);
const bar = await page.textContent("#offbar");
ok(/No signal/.test(bar) && /3 check-ins saved on this phone/.test(bar), "offline bar: No signal, 3 check-ins saved (" + bar.trim() + ")");
ok(/In 4/.test((await page.textContent("#count")).replace(/\s+/g, " ")), "count from the phone's copy: In 4 (" + (await page.textContent("#count")).replace(/\s+/g, " ") + ")");
await page.click('[data-tab="find"]'); await page.fill("#fq", "pass"); await page.waitForTimeout(600);
ok((await page.textContent("#found")).includes("Fay Pass"), "Find works offline from the phone's copy");
await page.locator("#found .person", { hasText: "Fay Pass" }).locator("[data-in]").click(); r = await result();
ok(/^In/.test(r) && r.includes("saved on this phone"), "Find > Check in offline: saved on this phone");
await page.waitForTimeout(400);
await page.locator("#found .person", { hasText: "Fay Pass" }).locator("[data-undo]").click();
await page.waitForTimeout(400);
ok(/3 check-ins/.test(await page.textContent("#offbar")), "Undo offline drops that unsent check-in (back to 3)");
await shot("3-offline-find");
await page.click('[data-tab="scan"]');

console.log("3. phone reloads with no signal");
await page.reload();
await page.waitForSelector("#app:not([hidden])", { timeout: 8000 });
ok(true, "door page opened with no signal, still signed in");
ok(await page.evaluate(() => document.fonts.ready.then(() => [...document.fonts].some((f) => f.status === "loaded"))), "fonts load from the saved copy too");
r = await type("OFFTST03"); ok(/^Used/.test(r), "saved check-ins survive the reload: Used");
ok(/3 check-ins/.test(await page.textContent("#offbar")), "still 3 waiting after reload");
ok((await db()).ticket_scans.length === 2, "server has only the 2 live scans so far");

console.log("4. signal back: saved check-ins send");
await off(false);
await page.evaluate(() => window.dispatchEvent(new Event("online")));
await page.waitForFunction((s) => JSON.parse(localStorage.getItem("stack_door_queue_" + s) || "[]").length === 0, SLUG, { timeout: 20000 });
let d = await db();
const byCode = (c) => d.tickets.find((t) => t.code === c).id;
const scan = (c) => d.ticket_scans.find((s) => s.ticket_id === byCode(c));
ok(scan("OFFTST03") && scan("OFFTST03").scanned_by === "door (offline)", "Cam's offline check-in is on the server, marked offline");
ok(scan("OFFTST04") && scan("OFFTST04").scanned_by === "door (offline)", "Dee's offline check-in is on the server");
ok(!scan("OFFTST06"), "Fay (undone offline) was never sent");
ok(scan("OFFTST07").scanned_by === "door", "Gus keeps the other phone's first scan");
await page.waitForTimeout(400);
const bar2 = await page.textContent("#offbar");
ok(/1 flagged after sending/.test(bar2) && bar2.includes("Gus Pass was already in at"), "clash shown: Gus Pass was already in (" + bar2.trim() + ")");
await shot("4-back-online-clash");
await page.click("#offok"); ok(await page.isHidden("#offbar"), "OK clears the clash note, bar hides");

console.log("5. weak signal: scan hangs, server did record it");
delayMs = 8000;
r = await type("OFFTST06");
ok(/^In/.test(r) && r.includes("saved on this phone"), "after 6s the phone stops waiting and checks its copy: In");
delayMs = 0;
await page.waitForFunction((s) => JSON.parse(localStorage.getItem("stack_door_queue_" + s) || "[]").length === 0, SLUG, { timeout: 30000 });
await page.waitForTimeout(400);
d = await db();
ok(d.ticket_scans.filter((s) => s.ticket_id === byCode("OFFTST06")).length === 1, "Fay is in once on the server");
ok(await page.isHidden("#offbar"), "the late live scan and the saved one are the same check-in, no clash shown");

ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
