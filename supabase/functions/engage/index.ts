import { db } from "../_shared/db.ts";
import { json, err, preflight, UUID_RE, clean } from "../_shared/util.ts";

const TYPES = new Set(["track_start", "track_30s", "track_complete", "bonus_play", "share_click"]);

// Play / share events from the pages. One row per type per member per hour, so
// a page refresh can't inflate anyone's score.
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return err("POST only", 405);
  let b: Record<string, unknown>; try { b = await req.json(); } catch { return err("Bad request"); }
  const t = clean(b.t, 40) || "", type = clean(b.type, 30) || "";
  if (!UUID_RE.test(t) || !TYPES.has(type)) return err("Bad request");
  const { data: m } = await db.from("subscribers").select("id").eq("access_token", t).maybeSingle();
  if (!m) return err("Not found", 404);
  const since = new Date(Date.now() - 3600000).toISOString();
  const { data: dup } = await db.from("engagement_events").select("id").eq("subscriber_id", m.id).eq("type", type).gte("created_at", since).limit(1);
  if (!dup?.length) {
    await db.from("engagement_events").insert({ subscriber_id: m.id, type });
    await db.from("subscribers").update({ last_engaged_at: new Date().toISOString() }).eq("id", m.id);
  }
  return json({ ok: true });
});
