// Referral ledger. Reads orders and writes only promoter_referrals / promoter_referral_credits.
// It does not change ticket prices, application fees, or the live show.
import { db, setting } from "./db.ts";
import {
  UNDERGROUND_EVENT_ID,
  creditLine,
  creditsForReferral,
  ledgerWrites,
} from "./referral_math.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
async function pages<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from <= 20000; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

type CreditRow = {
  id: string; referral_id: string; event_id: string; show_rank: number;
  paid_tickets: number; fee_cents: number; credit_cents: number;
  status: string; note: string | null; updated_at: string; settled_at: string | null;
};

async function applyWrites(referralId: string, existing: CreditRow[], desired: { event_id: string; show_rank: number; tickets: number; fee: number; credit: number }[]) {
  const now = new Date().toISOString();
  for (const w of ledgerWrites(existing, desired.map((d) => ({ ...d, paid_tickets: d.tickets, fee_cents: d.fee, credit_cents: d.credit })))) {
    let error: { message: string; code?: string } | null = null;
    if (w.op === "note" && w.id) {
      ({ error } = await db.from("promoter_referral_credits").update({ note: w.note, updated_at: now }).eq("id", w.id).eq("status", "settled"));
    } else if (w.op === "void" && w.id) {
      ({ error } = await db.from("promoter_referral_credits").update({
        paid_tickets: 0, fee_cents: 0, credit_cents: 0, status: "void", note: w.note, updated_at: now,
      }).eq("id", w.id).neq("status", "settled"));
    } else if (w.op === "update" && w.id) {
      ({ error } = await db.from("promoter_referral_credits").update({
        show_rank: w.show_rank, paid_tickets: w.paid_tickets, fee_cents: w.fee_cents, credit_cents: w.credit_cents,
        status: "pending", note: null, updated_at: now,
      }).eq("id", w.id).neq("status", "settled"));
    } else if (w.op === "insert") {
      ({ error } = await db.from("promoter_referral_credits").insert({
        referral_id: referralId, event_id: w.event_id, show_rank: w.show_rank,
        paid_tickets: w.paid_tickets, fee_cents: w.fee_cents, credit_cents: w.credit_cents,
        status: "pending", updated_at: now,
      }));
    }
    if (error && error.code !== "23505") console.error("referrals:", error.message);
  }
}

// Recompute pending credit for these referrers. Null means every referrer (Dylan's people page).
export async function reconcileReferrals(referrerIds: string[] | null): Promise<void> {
  const showLimit = Math.min(12, Math.max(1, Math.floor(num(await setting("promoter_referral_show_limit", 1), 1))));
  const shareBps = Math.min(10000, Math.max(0, Math.floor(num(await setting("promoter_referral_share_bps", 5000), 5000))));
  let rq = db.from("promoter_referrals").select("id,referrer_company_id,referred_company_id");
  if (referrerIds) rq = rq.in("referrer_company_id", referrerIds.length ? referrerIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: refs, error } = await rq;
  if (error) throw new Error(error.message);
  if (!refs?.length) return;

  const referredIds = [...new Set(refs.map((r) => r.referred_company_id as string))];
  const { data: cos, error: coErr } = await db.from("companies").select("id,legacy_stripe,slug").in("id", referredIds);
  if (coErr) throw new Error(coErr.message);
  const blocked = new Set((cos || []).filter((c) => c.legacy_stripe || c.slug === "quantum").map((c) => c.id as string));

  const events = await pages<{ id: string; company_id: string; slug: string; name: string; review_status: string; starts_at: string | null; created_at: string }>((from, to) =>
    db.from("events").select("id,company_id,slug,name,review_status,starts_at,created_at").in("company_id", referredIds).range(from, to));
  const safeEvents = events.filter((e) => e.id !== UNDERGROUND_EVENT_ID && e.slug !== "underground" && !blocked.has(e.company_id));
  const eventIds = safeEvents.map((e) => e.id);
  const orders = eventIds.length ? await pages<{ id: string; event_id: string; status: string; platform_fee_cents: number; paid_at: string | null; items: unknown }>((from, to) =>
    db.from("ticket_orders").select("id,event_id,status,platform_fee_cents,paid_at,items").in("event_id", eventIds).eq("status", "paid").range(from, to)) : [];
  const orderIds = orders.map((o) => o.id);
  const tickets = orderIds.length ? await pages<{ order_id: string; status: string; is_comp: boolean; unit_cents: number }>((from, to) =>
    db.from("tickets").select("order_id,status,is_comp,unit_cents").in("order_id", orderIds).range(from, to)) : [];
  const ticketsByOrder: Record<string, { status: string; is_comp: boolean; unit_cents: number }[]> = {};
  for (const t of tickets) (ticketsByOrder[t.order_id] ||= []).push(t);

  const existing = await pages<CreditRow>((from, to) =>
    db.from("promoter_referral_credits").select("id,referral_id,event_id,show_rank,paid_tickets,fee_cents,credit_cents,status,note,updated_at,settled_at")
      .in("referral_id", refs.map((r) => r.id)).range(from, to));

  for (const ref of refs) {
    if (blocked.has(ref.referred_company_id)) continue;
    const mine = safeEvents.filter((e) => e.company_id === ref.referred_company_id).map((e) => ({ ...e, legacy: false }));
    const desired = creditsForReferral({
      events: mine,
      orders: orders.filter((o) => mine.some((e) => e.id === o.event_id)),
      ticketsByOrder,
      shareBps,
      showLimit,
    });
    await applyWrites(ref.id, existing.filter((c) => c.referral_id === ref.id), desired);
  }
}

export type ReferralCard = {
  code: string; link: string; line: string; show_limit: number;
  pending_cents: number; settled_cents: number;
  rows: { id: string; crew: string; show: string; tickets: number; credit_cents: number; fee_cents: number; status: string; note: string | null }[];
};

export async function referralCards(companyIds: string[], siteUrl: string): Promise<Record<string, ReferralCard> | null> {
  try {
    await reconcileReferrals(companyIds);
    const showLimit = Math.min(12, Math.max(1, Math.floor(num(await setting("promoter_referral_show_limit", 1), 1))));
    const shareBps = Math.min(10000, Math.max(0, Math.floor(num(await setting("promoter_referral_share_bps", 5000), 5000))));
    const usual = await setting<number | null>("platform_fee_cents", null);
    const usualFee = typeof usual === "number" ? usual : null;
    const line = creditLine(showLimit, shareBps, usualFee);
    const { data: cos, error } = await db.from("companies").select("id,referral_code,legacy_stripe,slug")
      .in("id", companyIds.length ? companyIds : ["00000000-0000-0000-0000-000000000000"]);
    if (error) throw new Error(error.message);
    const { data: refs, error: refErr } = await db.from("promoter_referrals").select("id,referrer_company_id,referred_company_id")
      .in("referrer_company_id", companyIds.length ? companyIds : ["00000000-0000-0000-0000-000000000000"]);
    if (refErr) throw new Error(refErr.message);
    const refIds = (refs || []).map((r) => r.id as string);
    const credits = refIds.length ? (await db.from("promoter_referral_credits")
      .select("id,referral_id,event_id,paid_tickets,fee_cents,credit_cents,status,note")
      .in("referral_id", refIds)).data || [] : [];
    const referredIds = [...new Set((refs || []).map((r) => r.referred_company_id as string))];
    const eventIds = [...new Set(credits.map((c) => c.event_id as string))];
    const [{ data: crews }, { data: shows }] = await Promise.all([
      referredIds.length ? db.from("companies").select("id,name").in("id", referredIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      eventIds.length ? db.from("events").select("id,name,slug").in("id", eventIds) : Promise.resolve({ data: [] as { id: string; name: string; slug: string }[] }),
    ]);
    const crewName = new Map((crews || []).map((c) => [c.id, c.name]));
    const showName = new Map((shows || []).map((s) => [s.id, s.slug === "underground" ? "" : s.name]));
    const byRef = new Map((refs || []).map((r) => [r.id as string, r]));
    const out: Record<string, ReferralCard> = {};
    for (const co of cos || []) {
      if (co.legacy_stripe || co.slug === "quantum" || !co.referral_code) continue;
      const rows = credits.filter((c) => byRef.get(c.referral_id)?.referrer_company_id === co.id && c.event_id !== UNDERGROUND_EVENT_ID && showName.get(c.event_id) !== "").map((c) => ({
        id: c.id as string,
        crew: crewName.get(byRef.get(c.referral_id)!.referred_company_id) || "Promoter",
        show: showName.get(c.event_id) || "Show",
        tickets: c.paid_tickets as number,
        credit_cents: c.credit_cents as number,
        fee_cents: c.fee_cents as number,
        status: c.status as string,
        note: (c.note as string | null) || null,
      }));
      const pending = rows.filter((r) => r.status === "pending").reduce((s, r) => s + r.credit_cents, 0);
      const settled = rows.filter((r) => r.status === "settled").reduce((s, r) => s + r.credit_cents, 0);
      out[co.id] = {
        code: co.referral_code, link: `${siteUrl.replace(/\/$/, "")}/promoter?pref=${co.referral_code}`,
        line, show_limit: showLimit, pending_cents: pending, settled_cents: settled,
        rows: rows.filter((r) => r.status !== "void"),
      };
    }
    return out;
  } catch (e) {
    console.error("referrals:", (e as Error).message);
    return null;
  }
}

export type ReferralAdmin = {
  name: string; email: string | null; referred: string; show: string;
  tickets: number; fee: number; credit: number; status: string; note: string | null;
  when: string; belongs_to: string;
};

const STATUS_LABEL: Record<string, string> = { pending: "Pending", settled: "Paid", void: "Cleared" };

export async function referralAdminRows(): Promise<ReferralAdmin[] | null> {
  try {
    await reconcileReferrals(null);
    const { data: credits, error } = await db.from("promoter_referral_credits")
      .select("id,referral_id,event_id,paid_tickets,fee_cents,credit_cents,status,note,updated_at,settled_at")
      .order("updated_at", { ascending: false }).limit(2000);
    if (error) throw new Error(error.message);
    if (!credits?.length) return [];
    const { data: refs, error: refErr } = await db.from("promoter_referrals").select("id,referrer_company_id,referred_company_id")
      .in("id", credits.map((c) => c.referral_id));
    if (refErr) throw new Error(refErr.message);
    const refMap = new Map((refs || []).map((r) => [r.id as string, r]));
    const companyIds = [...new Set((refs || []).flatMap((r) => [r.referrer_company_id as string, r.referred_company_id as string]))];
    const eventIds = [...new Set(credits.map((c) => c.event_id as string))];
    const [{ data: cos }, { data: shows }] = await Promise.all([
      db.from("companies").select("id,name,contact_email,legacy_stripe,slug").in("id", companyIds.length ? companyIds : ["00000000-0000-0000-0000-000000000000"]),
      db.from("events").select("id,name,slug").in("id", eventIds.length ? eventIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);
    const co = new Map((cos || []).map((c) => [c.id as string, c]));
    const ev = new Map((shows || []).map((s) => [s.id as string, s]));
    const rows: ReferralAdmin[] = [];
    for (const c of credits) {
      if (c.event_id === UNDERGROUND_EVENT_ID) continue;
      const show = ev.get(c.event_id as string);
      if (!show || show.slug === "underground") continue;
      const ref = refMap.get(c.referral_id as string);
      if (!ref) continue;
      const referrer = co.get(ref.referrer_company_id);
      const referred = co.get(ref.referred_company_id);
      if (!referrer || referrer.legacy_stripe || referrer.slug === "quantum") continue;
      if (!referred || referred.legacy_stripe || referred.slug === "quantum") continue;
      rows.push({
        name: referrer.name, email: referrer.contact_email, referred: referred.name, show: show.name,
        tickets: c.paid_tickets, fee: (c.fee_cents || 0) / 100, credit: (c.credit_cents || 0) / 100,
        status: STATUS_LABEL[c.status] || c.status, note: c.note, when: c.settled_at || c.updated_at,
        belongs_to: referrer.name,
      });
    }
    return rows;
  } catch (e) {
    console.error("referrals:", (e as Error).message);
    return null;
  }
}

// Marks the ledger row paid. Does not call Stripe and does not move money.
export async function settleReferralCredit(creditId: string, subscriberId: string): Promise<{ ok: true } | { error: string }> {
  if (!UUID.test(creditId) || !UUID.test(subscriberId)) return { error: "Not found" };
  const { data: row } = await db.from("promoter_referral_credits").select("id,event_id,status,credit_cents").eq("id", creditId).maybeSingle();
  if (!row || row.status !== "pending" || !(row.credit_cents > 0)) return { error: "That credit is not waiting to be marked paid." };
  if (row.event_id === UNDERGROUND_EVENT_ID) return { error: "Not found" };
  const { data: ev } = await db.from("events").select("id,slug,company_id").eq("id", row.event_id).maybeSingle();
  if (!ev || ev.slug === "underground") return { error: "Not found" };
  const { data: co } = await db.from("companies").select("legacy_stripe,slug").eq("id", ev.company_id).maybeSingle();
  if (!co || co.legacy_stripe || co.slug === "quantum") return { error: "Not found" };
  const now = new Date().toISOString();
  const { data: updated, error } = await db.from("promoter_referral_credits").update({
    status: "settled", settled_at: now, settled_by: subscriberId, updated_at: now,
  }).eq("id", creditId).eq("status", "pending").select("id").maybeSingle();
  if (error || !updated) return { error: "That credit is not waiting to be marked paid." };
  return { ok: true };
}
