import { db } from "./db.ts";
import type { Member } from "./templates.ts";
import { sendNow } from "./sendnow.ts";

export type SigninMember = Member & { status: string };
export const MEMBER_COLS = "id,email,first_name,access_token,unsubscribe_token,referral_code,confirmed_referrals,status";

// Email a member their page link, right now (not via the 10-minute runner).
// At most one every 10 minutes per member, so nobody can flood an inbox by
// typing someone else's address. Logged in email_queue so it counts toward
// the daily budget; if the send fails the runner retries it.
export async function sendSignin(m: SigninMember): Promise<"sent" | "recent" | "queued"> {
  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const { data: recent } = await db.from("email_queue").select("id")
    .eq("subscriber_id", m.id).like("template_key", "signin:%").gte("created_at", since).limit(1);
  if (recent?.length) return "recent";

  const { data: row } = await db.from("email_queue")
    .insert({ subscriber_id: m.id, template_key: "signin:" + Date.now(), priority: 0, send_after: new Date(Date.now() + 15 * 60000).toISOString() })
    .select("id").single();
  if (!row) return "queued";
  // Someone who unsubscribed gets back in only by clicking this link (rejoin=1), never by typing the address.
  return (await sendNow(m, row.id, "signin", { rejoin: m.status === "unsubscribed" || m.status === "sunset" })) ? "sent" : "queued";
}
