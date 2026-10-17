import { db } from "../_shared/db.ts";
import { json, err } from "../_shared/util.ts";

// Brevo posts delivery events here. Hard bounces and complaints stop sends for good;
// soft bounces are left alone. Opens are logged but weighted low (Apple auto-opens).
Deno.serve(async (req) => {
  const k = new URL(req.url).searchParams.get("k");
  if (!k || k !== Deno.env.get("WEBHOOK_SECRET")) return err("Unauthorized", 401);
  let b: Record<string, unknown>; try { b = await req.json(); } catch { return err("Bad request"); }
  const email = String(b.email || "").toLowerCase();
  const ev = String(b.event || "");
  if (!email) return json({ ok: true });
  const { data: m } = await db.from("subscribers").select("id,status").eq("email", email).maybeSingle();
  if (!m) return json({ ok: true });

  if (ev === "hard_bounce" || ev === "invalid_email" || ev === "blocked") {
    await db.from("subscribers").update({ status: "bounced" }).eq("id", m.id);
    await db.from("email_queue").update({ status: "cancelled" }).eq("subscriber_id", m.id).eq("status", "pending");
  } else if (ev === "spam" || ev === "complaint") {
    await db.from("subscribers").update({ status: "complained" }).eq("id", m.id);
    await db.from("email_queue").update({ status: "cancelled" }).eq("subscriber_id", m.id).eq("status", "pending");
  } else if (ev === "unsubscribed") {
    await db.from("subscribers").update({ status: "unsubscribed" }).eq("id", m.id);
    await db.from("email_queue").update({ status: "cancelled" }).eq("subscriber_id", m.id).eq("status", "pending");
  } else if (ev === "opened" || ev === "unique_opened") {
    await db.from("engagement_events").insert({ subscriber_id: m.id, type: "email_open", meta: { tag: b.tag ?? null } });
  }
  return json({ ok: true });
});
