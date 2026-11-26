import { db } from "../_shared/db.ts";
import { json, preflight, clean } from "../_shared/util.ts";

// No PII. Source is the campaign, then the referring site, then "direct", so a view is never blank.
function safeRef(v: string | null): string | null {
  if (!v || !/^https?:\/\//i.test(v)) return null;
  try { const u = new URL(v); return (u.origin + u.pathname).slice(0, 200); } catch { return null; }
}
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* beacons can arrive as text */ }
  const path = clean(b.path, 80);
  if (path && /^\/[a-z0-9\-/]*$/i.test(path)) {
    const utm_source = clean(b.utm_source, 80), utm_medium = clean(b.utm_medium, 80), utm_campaign = clean(b.utm_campaign, 80);
    const referrer = safeRef(clean(b.referrer, 300));
    const host = referrer ? new URL(referrer).hostname.replace(/^www\./, "") : "";
    const source = (clean(b.source, 80) || utm_source || host || "direct").slice(0, 80);
    const row = { path, source, utm_source, utm_medium, utm_campaign, referrer, event_slug: clean(b.event_slug, 80), variant: clean(b.variant, 1) };
    const { error } = await db.from("page_views").insert(row);
    // The extra columns arrive with the migration. Until then, keep the view on the columns this table already has.
    if (error) await db.from("page_views").insert({ path, source: source.slice(0, 20), event_slug: row.event_slug, variant: row.variant });
  }
  return json({ ok: true });
});
