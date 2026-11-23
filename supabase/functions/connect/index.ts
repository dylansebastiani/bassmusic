import { db } from "../_shared/db.ts";
import { json, err, preflight, UUID_RE } from "../_shared/util.ts";
import { SITE_URL } from "../_shared/config.ts";
import { stripe } from "../_shared/tickets.ts";
import { staffAuth, canSee, canManage, loadCompany } from "../_shared/company.ts";

// Stripe Connect sign-up for a promoter's company (Standard account, so Stripe handles their
// identity checks, payouts, refunds and disputes, and Subduction never holds their money).
//   POST {a:"start", company}   company owner: make their Stripe account if needed, return Stripe's sign-up link
//   GET  ?a=status&company=id   anyone on that company: re-read Stripe and return where the account stands
Deno.serve(async (req) => {
  // Browsers ask first before sending the staff sign-in header (used by preview / Stripe sign-up).
  if (req.method === "OPTIONS") { const r = preflight(req)!; return new Response(null, { status: 204, headers: { ...Object.fromEntries(r.headers), "Access-Control-Allow-Headers": "content-type, x-admin-token" } }); }
  const st = await staffAuth(req);
  if (!st) return err("Sign in first.", 401);
  const u = new URL(req.url);

  if (req.method === "GET" && u.searchParams.get("a") === "status") {
    const id = u.searchParams.get("company") || "";
    if (!UUID_RE.test(id) || !canSee(st, id)) return err("Not found", 404);
    const co = await loadCompany(id);
    if (!co) return err("Not found", 404);
    if (co.legacy_stripe) return json({ connected: true, legacy: true, charges_enabled: true });
    if (!co.stripe_account_id) return json({ connected: false, charges_enabled: false });
    const a = await stripe(`accounts/${co.stripe_account_id}`, undefined, "GET");
    await db.from("companies").update({ stripe_charges_enabled: !!a.charges_enabled, stripe_details_submitted: !!a.details_submitted }).eq("id", co.id);
    return json({ connected: true, charges_enabled: !!a.charges_enabled, details_submitted: !!a.details_submitted }, 200, { "Cache-Control": "no-store" });
  }

  if (req.method !== "POST") return err("Not allowed", 405);
  let b: Record<string, unknown>; try { b = await req.json(); } catch { return err("Bad request"); }
  if (b.a !== "start") return err("Bad request");
  const id = typeof b.company === "string" ? b.company : "";
  if (!UUID_RE.test(id) || !canManage(st, id)) return err("Only the company's owner can connect Stripe.", 403);
  const co = await loadCompany(id);
  if (!co) return err("Not found", 404);
  if (co.legacy_stripe) return err("This company already sells through Subduction's own account.");
  if (co.status === "suspended") return err("This company is paused. Contact Subduction.");

  try {
    let acct = co.stripe_account_id;
    if (!acct) {
      const a = await stripe("accounts", { type: "standard", email: co.contact_email || st.email, metadata: { company_id: co.id, company: co.slug } });
      acct = a.id as string;
      await db.from("companies").update({ stripe_account_id: acct }).eq("id", co.id);
    }
    const back = `${SITE_URL}/admin.html?c=${encodeURIComponent(co.slug)}&stripe=`;
    const link = await stripe("account_links", { account: acct, type: "account_onboarding", refresh_url: back + "retry", return_url: back + "done" });
    return json({ url: link.url });
  } catch (e) {
    return err((e as Error).message || "Couldn't reach Stripe. Try again.", 502);
  }
});
