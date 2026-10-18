import { db } from "./db.ts";
import { render, unsubUrl, type Member } from "./templates.ts";
import { brevo as provider } from "./email/brevo.ts";   // <- swap provider here
import { SITE_URL } from "./config.ts";

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
    .insert({ subscriber_id: m.id, template_key: "signin:" + Date.now(), priority: 0 }).select("id").single();
  // Someone who unsubscribed gets back in only by clicking this link (rejoin=1), never by typing the address.
  const r = render("signin", m, { rejoin: m.status === "unsubscribed" || m.status === "sunset" })!;
  const res = await provider.send({
    to: { email: m.email, name: m.first_name }, subject: r.subject, html: r.html, text: r.text, tags: ["signin"],
    headers: {
      "List-Unsubscribe": `<${unsubUrl(m)}>, <mailto:${Deno.env.get("FROM_EMAIL") || "unsubscribe@" + new URL(SITE_URL).hostname}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (!row) return res.ok ? "sent" : "queued";
  if (res.ok) { await db.from("email_queue").update({ status: "sent", sent_at: new Date().toISOString(), attempts: 1 }).eq("id", row.id); return "sent"; }
  await db.from("email_queue").update({ attempts: 1, last_error: res.error.slice(0, 300) }).eq("id", row.id);
  return "queued";
}
