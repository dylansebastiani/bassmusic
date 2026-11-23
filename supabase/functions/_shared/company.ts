// Companies: who runs which shows, and what Subduction charges on them.
// Every function that shows or changes company data goes through staffAuth() and canSee(),
// so one promoter can never read another promoter's shows, orders or buyers.
import { db, setting } from "./db.ts";
import { sha256 } from "./util.ts";
import { isAdminEmail } from "./admin.ts";

export interface Company {
  id: string; slug: string; name: string; status: "pending" | "active" | "suspended";
  contact_email: string | null; stripe_account_id: string | null;
  stripe_charges_enabled: boolean; stripe_details_submitted: boolean;
  legacy_stripe: boolean; platform_fee_cents: number | null;
}
const COMPANY_COLS = "id,slug,name,status,contact_email,stripe_account_id,stripe_charges_enabled,stripe_details_submitted,legacy_stripe,platform_fee_cents";

export async function loadCompany(id: string | null | undefined): Promise<Company | null> {
  if (!id) return null;
  const { data } = await db.from("companies").select(COMPANY_COLS).eq("id", id).maybeSingle();
  return (data as Company) || null;
}

// The person behind a staff request. `owner` = Dylan (anyone on the platform staff list): sees every company.
// Everyone else sees only the companies they're listed on in company_staff.
export interface Staff { id: string; email: string; owner: boolean; companies: { id: string; role: "owner" | "staff" }[] }
export async function staffAuth(req: Request): Promise<Staff | null> {
  const token = (req.headers.get("x-admin-token") || "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data: s } = await db.from("admin_sessions").select("subscriber_id,expires_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  const { data: m } = await db.from("subscribers").select("id,email,status").eq("id", s.subscriber_id).maybeSingle();
  if (!m || m.status === "deleted") return null;
  const owner = await isAdminEmail(m.email);
  const { data: rows } = await db.from("company_staff").select("company_id,role").eq("subscriber_id", m.id);
  const companies = (rows || []).map((r) => ({ id: r.company_id as string, role: r.role as "owner" | "staff" }));
  if (!owner && !companies.length) return null;
  return { id: m.id, email: m.email, owner, companies };
}
export const canSee = (st: Staff, companyId: string | null | undefined) =>
  !!companyId && (st.owner || st.companies.some((c) => c.id === companyId));
export const canManage = (st: Staff, companyId: string | null | undefined) =>
  !!companyId && (st.owner || st.companies.some((c) => c.id === companyId && c.role === "owner"));

// Subduction's fee per paid ticket for this company, in cents. null = not set yet (checkout must refuse).
export async function feeFor(c: Company): Promise<number | null> {
  if (c.legacy_stripe) return 0;
  if (typeof c.platform_fee_cents === "number") return c.platform_fee_cents;
  const v = await setting<number | null>("platform_fee_cents", null);
  return typeof v === "number" && v >= 0 ? v : null;
}

// What the buyer pays on a Connect order, so the promoter keeps their full ticket price.
// Stripe takes 2.9% + 30c of the total on the promoter's account; Subduction's fee comes out as the
// application fee. Everything is rounded up so the promoter is never short. All amounts in cents.
export const CARD_PCT = 0.029, CARD_FIXED = 30;
export function connectTotals(netCents: number, paidTickets: number, feePerTicket: number) {
  if (netCents <= 0) return { platform: 0, card: 0, total: Math.max(0, netCents) };
  const platform = feePerTicket * paidTickets;
  const total = Math.ceil((netCents + platform + CARD_FIXED) / (1 - CARD_PCT));
  return { platform, card: total - netCents - platform, total };
}
// The all-in price of one ticket, for showing on the page (FTC rule: total price up front).
export const allInPrice = (unitCents: number, feePerTicket: number) => connectTotals(unitCents, 1, feePerTicket).total;
