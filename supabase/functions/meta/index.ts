import { db, setting } from "../_shared/db.ts";
import { json, preflight } from "../_shared/util.ts";
import { CONFIG } from "../_shared/config.ts";

// Public, cached: the active event for a QR slug (name + prize only) and the
// member count, which is only returned once it clears the social-proof threshold.
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const slug = (new URL(req.url).searchParams.get("e") || "").slice(0, 80);
  let event = null;
  if (slug) {
    const { data } = await db.from("events").select("slug,name,prize,venue,city").eq("slug", slug).eq("is_active", true).maybeSingle();
    event = data;
  }
  const { count } = await db.from("subscribers").select("id", { count: "exact", head: true }).eq("status", "active");
  const min = Number(await setting("social_proof_min", CONFIG.socialProofMin)) || 100;
  return json({ event, count: (count ?? 0) >= min ? count : null }, 200, { "Cache-Control": "public, max-age=120" });
});
