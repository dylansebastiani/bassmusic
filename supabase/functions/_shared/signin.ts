import { db, setting } from "./db.ts";
import type { Member } from "./templates.ts";
import { sha256 } from "./util.ts";
import { sendNow } from "./sendnow.ts";

export type SigninMember = Member & { status: string; light_token?: string };
export const MEMBER_COLS = "id,email,first_name,access_token,light_token,unsubscribe_token,referral_code,confirmed_referrals,status";

// The code is stored only as a hash, salted per member, so the table alone can't sign anyone in.
export const codeHash = async (subscriberId: string, code: string) =>
  sha256(`${subscriberId}|${code}|${await setting("ip_salt", "unset")}`);

// Email a member a 6-digit sign-in code (plus a backup link), right now.
// At most one a minute per member, so nobody can flood an inbox by typing
// someone else's address. A new code replaces the old one. Logged in
// email_queue so it counts toward the daily budget.
export async function sendSignin(m: SigninMember): Promise<"sent" | "recent" | "queued"> {
  const since = new Date(Date.now() - 60000).toISOString();
  const { data: recent } = await db.from("signin_codes").select("id")
    .eq("subscriber_id", m.id).gte("created_at", since).limit(1);
  if (recent?.length) return "recent";

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  await db.from("signin_codes").update({ used_at: new Date().toISOString() }).eq("subscriber_id", m.id).is("used_at", null);
  await db.from("signin_codes").insert({ subscriber_id: m.id, code_hash: await codeHash(m.id, code), expires_at: new Date(Date.now() + 10 * 60000).toISOString() });

  const { data: row } = await db.from("email_queue")
    .insert({ subscriber_id: m.id, template_key: "signin:" + Date.now(), priority: 0, send_after: new Date(Date.now() + 15 * 60000).toISOString() })
    .select("id").single();
  if (!row) return "queued";
  // Someone who unsubscribed gets back in only by proving it's them (code or link), never by typing the address.
  return (await sendNow(m, row.id, "signin", { code, rejoin: m.status === "unsubscribed" || m.status === "sunset" })) ? "sent" : "queued";
}
