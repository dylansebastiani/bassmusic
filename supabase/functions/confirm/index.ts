import { db, setting } from "../_shared/db.ts";
import { UUID_RE } from "../_shared/util.ts";
import { SITE_URL } from "../_shared/config.ts";

type Tier = { referrals: number; tier: string; label: string };

// /c/<access_token>: confirms the email, credits the referrer once, then sends
// the member to the bonus track. Always redirects; never shows an error page.
Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!UUID_RE.test(t)) return Response.redirect(SITE_URL + "/", 302);
  const { data: m } = await db.from("subscribers").select("id,email_confirmed_at,referred_by,status").eq("access_token", t).maybeSingle();
  if (!m || m.status === "deleted") return Response.redirect(SITE_URL + "/", 302);

  if (!m.email_confirmed_at) {
    const now = new Date().toISOString();
    // Only the first confirm wins; a second click must not credit the referrer twice.
    const { data: upd } = await db.from("subscribers").update({ email_confirmed_at: now, last_engaged_at: now })
      .eq("id", m.id).is("email_confirmed_at", null).select("id").maybeSingle();
    if (upd && m.referred_by) {
      const { data: ref } = await db.from("subscribers").select("id,confirmed_referrals,status").eq("id", m.referred_by).maybeSingle();
      if (ref) {
        const count = (ref.confirmed_referrals ?? 0) + 1;
        await db.from("subscribers").update({ confirmed_referrals: count, last_engaged_at: now }).eq("id", ref.id);
        await db.from("engagement_events").insert({ subscriber_id: ref.id, type: "referral_confirmed", ref_id: m.id });
        const tiers = await setting<Tier[]>("referral_tiers", []);
        const hit = tiers.find((x) => x.referrals === count);
        if (hit) {
          await db.from("rewards").insert({ subscriber_id: ref.id, tier: hit.tier, note: hit.label });
          if (ref.status === "active") {
            await db.from("email_queue").upsert(
              { subscriber_id: ref.id, template_key: "reward:" + hit.tier, priority: 2 },
              { onConflict: "subscriber_id,template_key", ignoreDuplicates: true });
          }
        }
      }
    }
  }
  return Response.redirect(`${SITE_URL}/bonus?t=${t}`, 302);
});
