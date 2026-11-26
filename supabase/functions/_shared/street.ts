// Street-team totals. Reads orders and writes only street_links.
// It does not change prices, fees, or the live show, and it sends no money.
import { db } from "./db.ts";
import { planLink, rollup, streetLine } from "./street_math.mjs";

export const UNDERGROUND_EVENT_ID = "63b511f3-d838-404f-9c2e-5d4b98fbf013";

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

type Show = { id: string; slug: string; name: string; company_id: string };

export function handsOff(show: { id: string; slug: string }, company: { slug: string; legacy_stripe: boolean }): boolean {
  return show.id === UNDERGROUND_EVENT_ID || show.slug === "underground" || company.slug === "quantum" || company.legacy_stripe === true;
}

async function report(show: Show, siteUrl: string) {
  const { data: links, error } = await db.from("street_links").select("id,code,label,payout_cents").eq("event_id", show.id).order("created_at");
  if (error) throw new Error(error.message);
  const orders = await pages<{ id: string; ref: string | null; status: string; discount_cents: number; items: unknown }>((from, to) =>
    db.from("ticket_orders").select("id,ref,status,discount_cents,items").eq("event_id", show.id).eq("status", "paid").not("ref", "is", null).range(from, to));
  const ids = orders.map((o) => o.id);
  const tickets = ids.length ? await pages<{ order_id: string; status: string; is_comp: boolean; unit_cents: number }>((from, to) =>
    db.from("tickets").select("order_id,status,is_comp,unit_cents").in("order_id", ids).range(from, to)) : [];
  const byOrder: Record<string, { status: string; is_comp: boolean; unit_cents: number }[]> = {};
  for (const t of tickets) (byOrder[t.order_id] ||= []).push(t);
  const base = siteUrl.replace(/\/$/, "");
  const rows = rollup(links || [], orders, byOrder).map((row) => ({
    ...row,
    link: `${base}/${show.slug}?ref=${encodeURIComponent(row.code)}`,
  }));
  return { ready: true, show: { id: show.id, name: show.name, slug: show.slug }, line: streetLine(), rows };
}

export async function streetView(show: Show, siteUrl: string): Promise<{ ready: boolean; show?: { id: string; name: string; slug: string }; line?: string; rows?: unknown[]; error?: string }> {
  try {
    return await report(show, siteUrl);
  } catch (e) {
    const msg = (e as Error).message || "";
    if (/street_links/.test(msg)) return { ready: false };
    console.error("street:", msg);
    return { ready: false, error: "Couldn't load links." };
  }
}

export async function saveStreetLink(show: Show, input: { label?: unknown; code?: unknown; payout?: unknown }, siteUrl: string) {
  const plan = planLink(input);
  if (plan.error) return { error: plan.error as string };
  const { error } = await db.from("street_links").upsert({
    company_id: show.company_id, event_id: show.id, code: plan.code, label: plan.label, payout_cents: plan.payout_cents,
  }, { onConflict: "event_id,code" });
  if (error) {
    console.error("street:", error.message);
    if (/street_links/.test(error.message)) return { error: "Street team links are not ready yet." };
    if (/live show|original account/.test(error.message)) return { error: "This show can't be changed here." };
    return { error: "Couldn't save that link." };
  }
  const view = await streetView(show, siteUrl);
  return view.ready ? view : { error: view.error || "Couldn't load links." };
}
