import { db } from "./db.ts";

// One giveaway entry per member per show. Returns true only the first time,
// so a re-scan never double-counts.
export async function enterEvent(subscriberId: string, eventId: string): Promise<boolean> {
  const { data } = await db.from("giveaway_entries")
    .upsert({ event_id: eventId, subscriber_id: subscriberId }, { onConflict: "event_id,subscriber_id", ignoreDuplicates: true })
    .select("id");
  const fresh = !!data?.length;
  if (fresh) await db.from("engagement_events").insert({ subscriber_id: subscriberId, type: "event_checkin", ref_id: eventId });
  await db.from("subscribers").update({ last_engaged_at: new Date().toISOString() }).eq("id", subscriberId);
  return fresh;
}
