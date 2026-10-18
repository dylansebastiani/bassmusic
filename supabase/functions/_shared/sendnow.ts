import { db } from "./db.ts";
import { render, unsubUrl, type Member } from "./templates.ts";
import { brevo as provider } from "./email/brevo.ts";   // <- swap provider here
import { SITE_URL } from "./config.ts";

// Send one queued email right now instead of waiting for the 10-minute runner.
// The queue row is the record: marked sent on success; on failure it stays
// pending and the runner retries it.
export async function sendNow(m: Member, rowId: string, key: string, extra?: Record<string, unknown>) {
  const r = render(key, m, extra);
  if (!r) return false;
  const res = await provider.send({
    to: { email: m.email, name: m.first_name }, subject: r.subject, html: r.html, text: r.text, tags: [key],
    headers: {
      "List-Unsubscribe": `<${unsubUrl(m)}>, <mailto:${Deno.env.get("FROM_EMAIL") || "unsubscribe@" + new URL(SITE_URL).hostname}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (res.ok) { await db.from("email_queue").update({ status: "sent", sent_at: new Date().toISOString(), attempts: 1 }).eq("id", rowId); return true; }
  await db.from("email_queue").update({ attempts: 1, last_error: res.error.slice(0, 300), send_after: new Date().toISOString() }).eq("id", rowId);
  return false;
}

// The welcome email shows the current free track.
// The cover comes from storage with a year-long link, so a track added from the staff page shows its art.
export async function welcomeExtra() {
  const { data } = await db.from("drops").select("slug,title,artist,artwork_path").eq("is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return undefined;
  const art = data.artwork_path ? await db.storage.from("drops").createSignedUrl(data.artwork_path, 365 * 86400) : null;
  return { drop: { slug: data.slug, title: data.title, artist: data.artist, artwork_url: art?.data?.signedUrl ?? null } };
}
