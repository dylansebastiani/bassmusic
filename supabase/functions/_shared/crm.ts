import { db, setting } from "./db.ts";

// Members go into the Brevo contact list too, so the CRM side always matches the site.
// One contact per email; attributes carry name, phone and ZIP. Never throws: a CRM
// hiccup must never break a signup.
type Row = { email: string; first_name: string | null; phone: string | null; zip: string | null; source: string | null; sms_consent: boolean | null };

const KEY = () => Deno.env.get("BREVO_API_KEY");
const H = (key: string) => ({ "api-key": key, "Content-Type": "application/json", "Accept": "application/json" });

export async function brevoLists(): Promise<Array<{ id: number; name: string; count: number }>> {
  const key = KEY(); if (!key) return [];
  const r = await fetch("https://api.brevo.com/v3/contacts/lists?limit=50", { headers: H(key) }).catch(() => null);
  if (!r?.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j.lists ?? []).map((l: { id: number; name: string; totalSubscribers?: number }) => ({ id: l.id, name: l.name, count: l.totalSubscribers ?? 0 }));
}

export async function brevoUpsert(m: Row): Promise<{ ok: boolean; error?: string }> {
  const key = KEY(); if (!key) return { ok: false, error: "BREVO_API_KEY not set" };
  const listId = await setting<number | null>("brevo_list_id", null);
  const attrs: Record<string, unknown> = { FIRSTNAME: m.first_name || undefined, ZIP: m.zip || undefined, SOURCE: m.source || undefined, SMS_CONSENT: !!m.sms_consent };
  const body = (withSms: boolean) => ({ email: m.email, updateEnabled: true, listIds: listId ? [listId] : undefined,
    attributes: withSms && m.phone ? { ...attrs, SMS: m.phone } : attrs });
  const send = (b: unknown) => fetch("https://api.brevo.com/v3/contacts", { method: "POST", headers: H(key), body: JSON.stringify(b) });
  let r = await send(body(true)).catch(() => null);
  // A phone Brevo rejects (or one already on another contact) must not block the rest.
  if (r && !r.ok && m.phone) { const t = await r.text().catch(() => ""); if (/sms|phone/i.test(t)) r = await send(body(false)).catch(() => null); }
  if (!r) return { ok: false, error: "network" };
  if (r.ok || r.status === 204) return { ok: true };
  return { ok: false, error: (await r.text().catch(() => "")).slice(0, 200) };
}

// Everyone active, in batches, for the one-time sync button.
export async function brevoSyncAll(): Promise<{ sent: number; failed: number; error?: string }> {
  const { data } = await db.from("subscribers").select("email,first_name,phone,zip,source,sms_consent").eq("status", "active").limit(5000);
  let sent = 0, failed = 0, error: string | undefined;
  for (const m of data ?? []) { const r = await brevoUpsert(m); if (r.ok) sent++; else { failed++; error = r.error; } }
  return { sent, failed, error };
}
