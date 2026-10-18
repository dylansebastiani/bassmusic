import { db, setting } from "../_shared/db.ts";
import { json, err, preflight, UUID_RE, clean, ipHash } from "../_shared/util.ts";
import { dropByQr, unlockTrack } from "../_shared/collection.ts";
import { enterEvent } from "../_shared/events.ts";

// What a track's QR code points at.
//   GET  ?c=CODE          title, artist and cover for the scan page. Logs a view.
//   POST {c, t, e?}       a remembered phone scans: the track lands in that member's
//                         collection with no typing. The key comes from the phone itself.
// A phone with no key goes through `subscribe` (email only), which unlocks the same way.
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  if (req.method === "GET") {
    const u = new URL(req.url);
    const drop = await dropByQr(u.searchParams.get("c"));
    if (!drop) return err("Not found", 404);
    // Which show's sticker: ?e=slug on the printed code.
    const es = clean(u.searchParams.get("e"), 80);
    const { data: ev } = es && /^[a-z0-9-]{1,80}$/i.test(es) ? await db.from("events").select("id").eq("slug", es).maybeSingle() : { data: null };
    // Count the view unless one connection is hammering the link. Its own bucket, so a
    // venue full of people scanning on one wifi can never use up the signup limit.
    const { data: n } = await db.rpc("bump_rate_limit", { p_ip_hash: await ipHash(req, (await setting("ip_salt", "unset")) + "|view") });
    if ((n ?? 0) <= 30) await db.from("track_scans").insert({ drop_id: drop.id, event_id: ev?.id ?? null, outcome: "view" });
    const art = drop.artwork_path ? await db.storage.from("drops").createSignedUrl(drop.artwork_path, 600) : null;
    return json({ slug: drop.slug, title: drop.title, artist: drop.artist, artwork_url: art?.data?.signedUrl ?? null }, 200, { "Cache-Control": "no-store" });
  }

  if (req.method !== "POST") return err("GET or POST only", 405);
  let b: Record<string, unknown>; try { b = await req.json(); } catch { return err("Bad request"); }
  const t = clean(b.t, 40) || "";
  if (!UUID_RE.test(t)) return err("Bad request");
  const drop = await dropByQr(clean(b.c, 20));
  if (!drop) return err("Not found", 404);
  const { data: m } = await db.from("subscribers").select("id,status").eq("access_token", t).maybeSingle();
  if (!m || m.status === "deleted") return err("Member not found", 404);
  // A scan at a show (?e=slug) also counts as being there: same as typing your email at the door.
  const slug = clean(b.e, 80);
  const { data: ev } = slug && /^[a-z0-9-]{1,80}$/i.test(slug)
    ? await db.from("events").select("id").eq("slug", slug).eq("is_active", true).maybeSingle() : { data: null };
  if (ev) await enterEvent(m.id, ev.id);
  const fresh = await unlockTrack(m.id, drop.id, ev?.id ?? null);
  return json({ unlocked: true, new_unlock: fresh, slug: drop.slug, title: drop.title });
});
