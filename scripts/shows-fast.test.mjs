// Locks the fast /shows path: the build-time list holds public fields only, the page paints from it,
// the directory GET is cacheable, and nothing blocks the first paint.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jsonInline } from "./cities.mjs";
import { publicCard } from "../supabase/functions/directory/listing.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const build = read("./build.mjs"), js = read("../site/assets/shows.js"), html = read("../site/shows.html"), fn = read("../supabase/functions/directory/index.ts");

// What the build writes: publicCard + jsonInline. Private fields and "</script>" must not survive.
const dirty = {
  source: "subduction", slug: "x", name: "A </script><b>", when: "Jan 9", dates: ["2027-01-09"], secret: true,
  city: "Peoria", state: "IL", url: "/x/", flyer: "https://cdn.example.com/f.webp", fresh: false,
  lineup: [{ name: "Secret DJ" }], venue: "Hangovers", address: "123 Hidden St", address_full: "123 Hidden St", submitter_email: "a@b.co",
};
const out = jsonInline([publicCard(dirty)]);
assert.doesNotMatch(out, /lineup|venue|address|Secret DJ|Hangovers|123 Hidden|a@b\.co|<\/script/i);
assert.deepEqual(Object.keys(JSON.parse(out)[0]).sort(), ["city", "dates", "flyer", "fresh", "name", "path", "secret", "slug", "source", "state", "url", "when"]);
assert.match(build, /\.map\(publicCard\)/);
assert.match(build, /window\.__SHOWS_DATA=\$\{jsonInline\(safe\)\}/);
assert.match(build, /rel="preload" as="image"/);

// The page paints from the build list, then swaps only if the live list differs.
assert.match(js, /window\.__SHOWS_DATA/);
assert.match(js, /JSON\.stringify\(live\) === JSON\.stringify\(all\)/);
// A failed or malformed live response must not wipe the seed.
assert.match(js, /if \(!r\.ok\) throw/);
assert.match(js, /if \(!Array\.isArray\(j && j\.shows\)\) throw/);
assert.doesNotMatch(js, /\(j && j\.shows\) \|\| \[\]/);
// The throws must come before the list is replaced.
assert.ok(js.indexOf("if (!Array.isArray(j && j.shows)) throw") < js.indexOf("all = live;"));
// Stale seed: build time is written with jsonInline and old listings are dropped on failure, events kept.
assert.match(build, /window\.__SHOWS_BUILT=\$\{jsonInline\(Date\.now\(\)\)\}/);
assert.match(js, /window\.__SHOWS_BUILT/);
assert.match(js, /12 \* 3600 \* 1000/);
assert.match(js, /s\.source !== "listing"/);
assert.match(js, /fetchpriority="high"/);
assert.match(js, /loading="lazy"/);
assert.match(js, /width="' \+/);

// Cacheable GET, and no blocking script in /shows.
assert.match(fn, /"public, max-age=60, stale-while-revalidate=300"/);
for (const n of ["stack", "fees", "shows"]) assert.match(html, new RegExp(`<script src="/assets/${n}\\.js" defer></script>`));
assert.doesNotMatch(html.split("</head>")[0], /<script[^>]+src=/);
assert.doesNotMatch(html.split("</head>")[0], /fonts\.googleapis/);
console.log("shows-fast checks passed");

// The 12-hour stale drop: an old build with a failed live fetch must drop pulled listings but keep Subduction events.
assert.match(js, /var STALE_MS = 12 \* 3600 \* 1000/);
assert.match(js, /Date\.now\(\) - built > STALE_MS/);
assert.match(js, /s\.source !== "listing"/);
