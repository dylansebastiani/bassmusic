import { db } from "../_shared/db.ts";
import { json, err, preflight, UUID_RE, clean, e164 } from "../_shared/util.ts";
import { CONFIG, fill } from "../_shared/config.ts";
import { brevoUpsert } from "../_shared/crm.ts";
import { memberByKey } from "../_shared/collection.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return err("POST only", 405);
  let b: Record<string, unknown>; try { b = await req.json(); } catch { return err("Bad request"); }
  const t = clean(b.t, 40) || "";
  if (!UUID_RE.test(t)) return err("Not found", 404);
  const m = await memberByKey(t, "sms_consent,email,source,first_name,phone,zip") as
    (null | { id: string; status: string; full: boolean; sms_consent: boolean | null; email: string; source: string | null; first_name: string | null; phone: string | null; zip: string | null });
  if (!m || m.status === "deleted") return err("Not found", 404);
  // A QR scan's light key can fill in the wall once, while nothing is on file. Changing details takes the emailed code.
  if (!m.full && (m.first_name || m.phone || m.zip)) return err("To change your info, sign out and sign in with the code we email you.", 403);

  // unlock = the track wall: first name, phone and ZIP are all required.
  const unlock = b.unlock === true;
  if (unlock && !clean(b.first_name, 80)) return err("Add your first name.");
  if (unlock && !clean(b.phone, 30)) return err("Add your phone number.");
  if (unlock && !clean(b.zip, 12)) return err("Add your ZIP.");
  if (unlock && b.age_confirmed !== true) return err("Tick the box to confirm you're 13 or older.");
  const zip = clean(b.zip, 12);
  if (zip && !/^\d{5}(-?\d{4})?$/.test(zip)) return err("That ZIP doesn't look right.");
  const phone = e164(clean(b.phone, 30));
  if (clean(b.phone, 30) && !phone) return err("That phone number doesn't look right.");
  // The number is kept either way; texting needs the box ticked (and it is never required).
  const consent = b.sms_consent === true;

  const patch: Record<string, unknown> = {
    first_name: clean(b.first_name, 80), zip, phone,
    age_confirmed: b.age_confirmed === true ? true : null,
    last_engaged_at: new Date().toISOString(),
  };
  if (phone && consent) {
    // Store exactly what they agreed to and when. TCPA wants the receipt.
    patch.sms_consent = true;
    patch.sms_consent_text = fill(CONFIG.smsConsentText, { LABEL_NAME: CONFIG.labelName || CONFIG.membershipName });
    patch.sms_consent_at = new Date().toISOString();
  } else if (!phone || b.sms_consent === false) {
    // No number, or the box unticked: no texts. Withdrawing is as easy as giving it.
    patch.sms_consent = false;
  }
  // Partial saves never wipe what's already on file.
  for (const k of ["first_name", "zip", "phone", "age_confirmed"]) if (patch[k] == null) delete patch[k];
  const { error } = await db.from("subscribers").update(patch).eq("id", m.id);
  if (error) return err("Couldn't save.", 500);
  await db.from("engagement_events").insert({ subscriber_id: m.id, type: unlock ? "track_unlock" : "profile_update" });
  // The CRM gets the new details in the background.
  const { data: now } = await db.from("subscribers").select("email,first_name,phone,zip,source,sms_consent").eq("id", m.id).maybeSingle();
  if (now) (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(brevoUpsert(now).catch(() => ({ ok: false })));
  return json({ ok: true });
});
