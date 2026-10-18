import { db, setting } from "./db.ts";
import { sha256 } from "./util.ts";

// Admins are members whose email is on the allow list in settings.admin_emails.
// They sign in with the same emailed 6-digit code as everyone else; what they get
// back is a 30-day session token, kept on their phone, stored here only as a hash.
export const SESSION_DAYS = 30;

export async function isAdminEmail(email: string) {
  const list = await setting<string[]>("admin_emails", []);
  return list.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

export async function newSession(subscriberId: string) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
  await db.from("admin_sessions").insert({ subscriber_id: subscriberId, token_hash: await sha256(token),
    expires_at: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() });
  return token;
}

// The admin behind a request, or null. Also re-checks the allow list, so removing an
// email from it ends that person's access at once.
export async function requireAdmin(req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get("x-admin-token") || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data: s } = await db.from("admin_sessions").select("subscriber_id,expires_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  const { data: m } = await db.from("subscribers").select("id,email,status").eq("id", s.subscriber_id).maybeSingle();
  if (!m || m.status === "deleted" || !(await isAdminEmail(m.email))) return null;
  return { id: m.id, email: m.email };
}
