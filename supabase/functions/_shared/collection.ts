import { db } from "./db.ts";

export const QR_RE = /^[A-Z0-9]{6,12}$/;

// A member by either key. `full` is true for the real key (emailed code or link),
// false for the light key a QR scan hands out, which never touches personal details.
export async function memberByKey<T extends string>(t: string, cols: T): Promise<(Record<string, unknown> & { id: string; status: string; full: boolean }) | null> {
  const { data } = await db.from("subscribers").select(`id,status,access_token,${cols}`).or(`access_token.eq.${t},light_token.eq.${t}`).limit(1).maybeSingle();
  if (!data) return null;
  const row = data as unknown as Record<string, unknown> & { id: string; status: string; access_token: string };
  const full = row.access_token === t;
  delete (row as { access_token?: string }).access_token;
  return { ...row, full };
}
export type QrDrop = { id: string; slug: string; title: string; artist: string | null; artwork_path: string | null };

// The track behind a QR code. Codes are case-insensitive; a retired code (qr_active = false) finds nothing.
export async function dropByQr(raw: string | null): Promise<QrDrop | null> {
  const code = (raw || "").trim().toUpperCase();
  if (!QR_RE.test(code)) return null;
  const { data } = await db.from("drops").select("id,slug,title,artist,artwork_path")
    .eq("qr_code", code).eq("qr_active", true).maybeSingle();
  return data;
}

// Put a track in a member's collection. True only the first time, so a re-scan never
// double-counts. Every call is logged in track_scans, which is what per-artist numbers read.
export async function unlockTrack(subscriberId: string, dropId: string, eventId: string | null = null): Promise<boolean> {
  const { data } = await db.from("collection_items")
    .upsert({ subscriber_id: subscriberId, drop_id: dropId, event_id: eventId }, { onConflict: "subscriber_id,drop_id", ignoreDuplicates: true })
    .select("id");
  const fresh = !!data?.length;
  await db.from("track_scans").insert({ drop_id: dropId, subscriber_id: subscriberId, event_id: eventId, outcome: fresh ? "unlocked" : "already" });
  if (fresh) await db.from("engagement_events").insert({ subscriber_id: subscriberId, type: "track_unlock", ref_id: dropId });
  await db.from("subscribers").update({ last_engaged_at: new Date().toISOString() }).eq("id", subscriberId);
  return fresh;
}
