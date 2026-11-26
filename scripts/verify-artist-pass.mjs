// Static checks for the artist-pass backfill. Reads the migration and the
// promoter show-save path. Does not connect to a database and does not send email.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const migrationPath = join(root, "supabase/migrations/0049_artist_pass_backfill.sql");
const promoterPath = join(root, "supabase/functions/promoter/index.ts");
const migration = readFileSync(migrationPath, "utf8");
const promoter = readFileSync(promoterPath, "utf8");
const stripped = migration.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

const problems = [];
const bad = (m) => problems.push(m);
const UNDERGROUND = "63b511f3-d838-404f-9c2e-5d4b98fbf013";
const SHOWS = [
  ["9743b63f-088a-427a-ae15-458b1a141e2d", "test-night"],
  ["8c9d2b30-0b91-4d4a-91e3-9bb8dd3e127d", "test-fest"],
  ["1cbc1482-f426-42a2-9c50-9457f52cef89", "zz-lane-test"],
  ["d5c4072b-cf8b-406d-84ba-732c1372b950", "testing"],
  ["a3b8d360-c347-415a-9184-c098beefa9a8", "test-grok-show"],
];

for (const word of ["\\bupdate\\b", "\\bdelete\\b", "\\balter\\b", "\\bdrop\\b", "\\btruncate\\b", "create\\s+trigger", "create\\s+(or\\s+replace\\s+)?function"]) {
  if (new RegExp(word, "i").test(stripped)) bad(`migration SQL contains ${word}`);
}
const inserts = stripped.match(/insert\s+into\s+[a-z_.]+/gi) || [];
if (inserts.length !== 1 || !/insert\s+into\s+public\.ticket_types/i.test(inserts[0])) {
  bad(`migration must insert once, into public.ticket_types (found ${inserts.join(", ") || "none"})`);
}
if (!/e\.slug\s*<>\s*'underground'/.test(stripped)) bad("migration WHERE must exclude slug underground");
if (!/e\.id\s*<>\s*underground/.test(stripped)) bad("migration WHERE must exclude the underground event id");
if (!stripped.includes(UNDERGROUND)) bad("migration must name the underground event id");
if (!/not exists\s*\(/.test(stripped)) bad("migration must skip a show that already has an artist pass");
if (!/slug,\s*'artist'/.test(stripped) && !/'artist',\s*'Artist Pass',\s*'Artists only'/.test(stripped)) {
  bad("migration must insert slug artist, name Artist Pass, blurb Artists only");
}
if (!/'\[\]'::jsonb,\s*false,\s*99/.test(stripped)) bad("migration must use empty tiers, on sale false, sort 99");
if (/email_queue|artist_invites|ticket_orders|net\.http|pg_net|pg_notify/i.test(stripped)) bad("migration must not write mail, invites, or orders");
for (const [id, slug] of SHOWS) {
  if (!migration.includes(id)) bad(`migration missing event id for ${slug}`);
  if (!migration.includes(`'${slug}'`)) bad(`migration missing slug ${slug}`);
}
if (migration.includes("'underground'") && !/slug\s*<>\s*'underground'|slug is distinct from 'underground'|slug = 'underground'/.test(stripped)) {
  bad("underground slug appears without an exclusion");
}

const saveAt = promoter.indexOf('if (a === "show-save")');
const save = saveAt >= 0 ? promoter.slice(saveAt, promoter.indexOf('if (!show)', saveAt)) : "";
if (!save) bad("could not find show-save");
const guard = save.indexOf('show.slug === "underground"');
const wipe = save.indexOf('ticket_types").delete');
if (guard < 0 || wipe < 0 || guard > wipe) bad("underground guard must return before ticket types are replaced");
if (!promoter.includes(`const UNDERGROUND_EVENT_ID = "${UNDERGROUND}"`)) bad("promoter must name the underground event id");
if (!save.includes("UNDERGROUND_EVENT_ID")) bad("show-save must check the underground event id");
if (!save.includes('slug === "underground"') || !save.includes("id !== UNDERGROUND_EVENT_ID")) bad("artist-pass insert must skip underground");
for (const piece of ['slug: "artist"', 'name: "Artist Pass"', 'blurb: "Artists only"', "on_sale: false", "sort: 99", "tiers: []"]) {
  if (!save.includes(piece)) bad(`show-save artist pass is missing ${piece}`);
}
if (/email_queue|sendNow|sendTickets|sendInvite/.test(save)) bad("show-save must not send mail");

if (problems.length) {
  console.error(problems.map((p) => "FAIL " + p).join("\n"));
  process.exit(1);
}
console.log("artist pass checks ok");
