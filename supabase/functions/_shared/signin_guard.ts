// Limits on the emailed sign-in codes, kept per person (not per IP), so they hold however many addresses an
// attacker rotates through. Counted in engagement_events, so no new table is needed.
//   - 10 wrong guesses a day across ALL of a person's codes, then locked until the count ages out (24h rolling)
//   - 10 code emails a day per address (stops inbox flooding)
//   - a new code cancels every older live one
import { db } from "./db.ts";

export const MAX_FAILS_PER_DAY = 10;
export const MAX_CODE_EMAILS_PER_DAY = 10;
const DAY_MS = 86400000;

async function countToday(subscriberId: string, type: string): Promise<number> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { count, error } = await db.from("engagement_events").select("id", { count: "exact", head: true })
    .eq("subscriber_id", subscriberId).eq("type", type).gte("created_at", since);
  // If the count can't be read, fail closed for guesses (see callers): treat as at the cap.
  return error ? Number.MAX_SAFE_INTEGER : (count ?? 0);
}
export async function guessesLocked(subscriberId: string): Promise<boolean> {
  return (await countToday(subscriberId, "signin:fail")) >= MAX_FAILS_PER_DAY;
}
export async function noteGuessFail(subscriberId: string): Promise<void> {
  await db.from("engagement_events").insert({ subscriber_id: subscriberId, type: "signin:fail" });
}
export async function codeEmailAllowed(subscriberId: string): Promise<boolean> {
  return (await countToday(subscriberId, "signin:sent")) < MAX_CODE_EMAILS_PER_DAY;
}
export async function noteCodeEmail(subscriberId: string): Promise<void> {
  await db.from("engagement_events").insert({ subscriber_id: subscriberId, type: "signin:sent" });
}
// Every older live code for this person stops working.
export async function cancelLiveCodes(subscriberId: string): Promise<void> {
  await db.from("signin_codes").update({ used_at: new Date().toISOString() }).eq("subscriber_id", subscriberId).is("used_at", null);
}
