// Locks the artist waitlist rules: ROLE Artist, no list, no mail to the artist, promoters are not members.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { artistContactBody, smsNumber, subscriberRole } from "../supabase/functions/artist-waitlist/contact.mjs";

const body = artistContactBody({ email: "ada@example.com", name: "Ada Lovelace", phone: "+13095550100" }, true);
assert.deepEqual(Object.keys(body).sort(), ["attributes", "email", "updateEnabled"]);
assert.equal(body.email, "ada@example.com");
assert.equal(body.updateEnabled, true);
assert.equal(body.attributes.ROLE, "Artist");
assert.equal(body.attributes.SOURCE, "artist-waitlist");
assert.equal(body.attributes.FIRSTNAME, "Ada");
assert.equal(body.attributes.LASTNAME, "Lovelace");
assert.equal(body.attributes.SMS, "+13095550100");
assert.equal("listIds" in body, false);
assert.equal("includeListIds" in body, false);
assert.equal("templateId" in body, false);

const noPhone = artistContactBody({ email: "ada@example.com", name: "Ada", phone: "+13095550100" }, false);
assert.equal("SMS" in noPhone.attributes, false);
assert.equal(noPhone.attributes.ROLE, "Artist");

assert.equal(smsNumber("(309) 555-0100"), "+13095550100");
assert.equal(smsNumber("+1 309 555 0100"), "+13095550100");
assert.equal(smsNumber("555-0100"), null);
assert.equal(smsNumber(""), null);

assert.equal(subscriberRole("promoter", false), "Promoter");
assert.equal(subscriberRole("ig", true), "Promoter");
assert.equal(subscriberRole("ig", false), "Member");
assert.equal(subscriberRole(null, false), "Member");
assert.equal(subscriberRole("direct", false), "Member");

const wait = readFileSync(new URL("../supabase/functions/artist-waitlist/index.ts", import.meta.url), "utf8");
for (const banned of ["doubleOptin", "listIds", "includeListIds", "templateId", "email_queue", "email-runner", "follow up"]) {
  assert.equal(wait.includes(banned), false, "artist-waitlist must not contain " + banned);
}
assert.match(wait, /to: adminsTo\.map/);
assert.doesNotMatch(wait, /to:\s*\[\s*\{\s*email:\s*(email|row\.email|fields\.email)/);
assert.match(wait, /replyTo:\s*\{\s*email:\s*row\.email\s*\}/);
assert.match(wait, /New artist signup:/);
assert.doesNotMatch(wait, /—|–/);

const crm = readFileSync(new URL("../supabase/functions/crm-sync/index.ts", import.meta.url), "utf8");
assert.match(crm, /subscriberRole\(/);
assert.match(crm, /source: "artist-waitlist" \}, false, false\)/);
assert.match(crm, /Promoter: 1/);
assert.match(crm, /withList \? \[listId!/);
assert.match(crm, /lists \? \{ listIds: lists \}/);
assert.doesNotMatch(crm, /smtp\/email/);
assert.doesNotMatch(crm, /doubleOptin/);

console.log("artist-waitlist checks passed");
