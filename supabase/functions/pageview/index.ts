import { db } from "../_shared/db.ts";
import { json, preflight, clean } from "../_shared/util.ts";

// No PII. Just enough to compute conversion per source, event and headline variant.
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* beacons can arrive as text */ }
  const path = clean(b.path, 40);
  if (path && /^\/[a-z0-9\-/]*$/i.test(path)) {
    await db.from("page_views").insert({ path, source: clean(b.source, 20), event_slug: clean(b.event_slug, 80), variant: clean(b.variant, 1) });
  }
  return json({ ok: true });
});
