import { db, setting } from "../_shared/db.ts";
import { json, err } from "../_shared/util.ts";
import { render, unsubUrl, type Member } from "../_shared/templates.ts";
import { brevo as provider } from "../_shared/email/brevo.ts";   // <- swap provider here
import { SITE_URL } from "../_shared/config.ts";

// Runs every 10 minutes from pg_cron. Sends what's due, newest priority first,
// and stops at the daily budget so the free tier never bounces a send.
Deno.serve(async (req) => {
  const secret = await setting<string>("runner_secret", "");
  if (!secret || req.headers.get("x-runner-secret") !== secret) return err("Unauthorized", 401);

  const budget = Number(await setting("email_daily_budget", 280)) || 280;
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count: sentToday } = await db.from("email_queue").select("id", { count: "exact", head: true })
    .eq("status", "sent").gte("sent_at", dayStart.toISOString());
  let room = budget - (sentToday ?? 0);
  if (room <= 0) return json({ sent: 0, reason: "daily budget reached", budget });

  const { data: due } = await db.from("email_queue")
    .select("id,template_key,attempts,subscriber:subscribers(id,email,first_name,access_token,unsubscribe_token,referral_code,confirmed_referrals,status,email_pref)")
    .eq("status", "pending").lte("send_after", new Date().toISOString())
    .order("priority").order("send_after").limit(Math.min(room, 50));

  let sent = 0, failed = 0, skipped = 0, stopped = false;
  let currentDrop: { slug: string; title: string; artist: string | null } | null | undefined;
  for (const row of due ?? []) {
    const s = row.subscriber as unknown as (Member & { status: string; email_pref: string }) | null;
    if (!s || s.status !== "active") { await db.from("email_queue").update({ status: "cancelled", last_error: "subscriber not active" }).eq("id", row.id); skipped++; continue; }

    const [key, arg] = row.template_key.split(":");
    let extra: Record<string, unknown> | undefined;
    if (key === "welcome") {
      if (currentDrop === undefined) {
        const { data } = await db.from("drops").select("slug,title,artist").eq("is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
        currentDrop = data ?? null;
      }
      extra = currentDrop ? { drop: currentDrop } : undefined;
    }
    if (key === "reward") {
      const tiers = await setting<Array<{ tier: string; label: string }>>("referral_tiers", []);
      extra = { label: tiers.find((x) => x.tier === arg)?.label || "a reward" };
    }
    const r = render(key, s, extra);
    if (!r) { await db.from("email_queue").update({ status: "failed", last_error: "unknown template " + row.template_key }).eq("id", row.id); failed++; continue; }

    const res = await provider.send({
      to: { email: s.email, name: s.first_name }, subject: r.subject, html: r.html, text: r.text, tags: [key],
      headers: {
        "List-Unsubscribe": `<${unsubUrl(s)}>, <mailto:${Deno.env.get("FROM_EMAIL") || "unsubscribe@" + new URL(SITE_URL).hostname}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.ok) {
      await db.from("email_queue").update({ status: "sent", sent_at: new Date().toISOString(), attempts: row.attempts + 1 }).eq("id", row.id);
      sent++; room--;
      if (room <= 0) break;
    } else if (res.rateLimited) {
      await db.from("email_queue").update({ last_error: res.error, attempts: row.attempts + 1 }).eq("id", row.id);
      stopped = true; break;   // provider says enough for today
    } else {
      const attempts = row.attempts + 1;
      const backoffMin = 15 * Math.pow(2, attempts);
      await db.from("email_queue").update({
        attempts, last_error: res.error.slice(0, 300),
        status: attempts >= 3 ? "failed" : "pending",
        send_after: new Date(Date.now() + backoffMin * 60000).toISOString(),
      }).eq("id", row.id);
      failed++;
    }
  }
  return json({ sent, failed, skipped, stopped, budget, sent_today: (sentToday ?? 0) + sent });
});
