import { db } from "../_shared/db.ts";
import { json, err, preflight, UUID_RE, clean, e164 } from "../_shared/util.ts";
import { CONFIG, fill } from "../_shared/config.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return err("POST only", 405);
  let b: Record<string, unknown>; try { b = await req.json(); } catch { return err("Bad request"); }
  const t = clean(b.t, 40) || "";
  if (!UUID_RE.test(t)) return err("Not found", 404);
  const { data: m } = await db.from("subscribers").select("id,sms_consent").eq("access_token", t).maybeSingle();
  if (!m) return err("Not found", 404);

  const zip = clean(b.zip, 12);
  if (zip && !/^\d{5}(-?\d{4})?$/.test(zip)) return err("That ZIP doesn't look right.");
  const phone = e164(clean(b.phone, 30));
  if (clean(b.phone, 30) && !phone) return err("That phone number doesn't look right.");
  const consent = b.sms_consent === true;
  if (phone && !consent) return err("Tick the text-me box to add a phone number.");

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
  } else if (!phone) {
    patch.sms_consent = false;
  }
  const { error } = await db.from("subscribers").update(patch).eq("id", m.id);
  if (error) return err("Couldn't save.", 500);
  await db.from("engagement_events").insert({ subscriber_id: m.id, type: "profile_update" });
  return json({ ok: true });
});
