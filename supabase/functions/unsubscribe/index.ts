import { db } from "../_shared/db.ts";
import { UUID_RE } from "../_shared/util.ts";
import { CONFIG, SITE_URL } from "../_shared/config.ts";

// GET: a human clicked the footer link. POST: Gmail/Yahoo one-click (RFC 8058).
// Either way it's immediate, needs no login, and cancels anything still queued.
async function unsub(u: string) {
  if (!UUID_RE.test(u)) return false;
  const { data: m } = await db.from("subscribers").select("id,status").eq("unsubscribe_token", u).maybeSingle();
  if (!m) return false;
  if (m.status === "active" || m.status === "sunset") await db.from("subscribers").update({ status: "unsubscribed" }).eq("id", m.id);
  await db.from("email_queue").update({ status: "cancelled" }).eq("subscriber_id", m.id).eq("status", "pending");
  return true;
}
const page = (title: string, body: string) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#eee;font:16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;text-align:center;padding:24px}a{color:#fff}</style></head>
<body><div><h1 style="font-size:22px;letter-spacing:.1em;text-transform:uppercase">${title}</h1><p>${body}</p><p><a href="${SITE_URL}/">${CONFIG.labelName || CONFIG.membershipName}</a></p></div></body></html>`,
  { headers: { "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  const u = new URL(req.url).searchParams.get("u") || "";
  const ok = await unsub(u);
  if (req.method === "POST") return new Response(ok ? "ok" : "not found", { status: ok ? 200 : 404 });
  return ok
    ? page("You're out", "No more emails from us. If that was a mistake, just join again from the site.")
    : page("Link not recognised", "That link didn't match anyone. Try the unsubscribe link in your most recent email from us.");
});
