import { db } from "../_shared/db.ts";
import { json, err, preflight, UUID_RE, clean } from "../_shared/util.ts";
import { enterEvent } from "../_shared/events.ts";

// A remembered phone scans a show's QR code: enter that show for the member,
// no typing. The member key comes from the phone itself, so this is as strong
// as the key; a stranger has no key to send.
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return err("POST only", 405);
  let b: Record<string, unknown>; try { b = await req.json(); } catch { return err("Bad request"); }
  const t = clean(b.t, 40) || "", slug = clean(b.e, 80) || "";
  if (!UUID_RE.test(t) || !/^[a-z0-9-]{1,80}$/i.test(slug)) return err("Bad request");

  const { data: m } = await db.from("subscribers").select("id,status").eq("access_token", t).maybeSingle();
  if (!m || m.status === "deleted") return err("Not found", 404);
  const { data: ev } = await db.from("events").select("id,slug,name,prize").eq("slug", slug).eq("is_active", true).maybeSingle();
  if (!ev) return json({ event: null, entered: false });

  const fresh = await enterEvent(m.id, ev.id);
  return json({ event: { slug: ev.slug, name: ev.name, prize: ev.prize }, entered: true, new_entry: fresh });
});
