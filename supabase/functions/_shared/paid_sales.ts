// Read-only: what each show has really sold. Paid orders only (refunded, comp and pending are out),
// no comp tickets, no "test" or "artist" ticket types. Face price is each ticket's own unit_cents.
// Returns per event: count, face_cents, and by_price [[unit_cents, qty]] so the browser can estimate fee savings.
export type PaidSales = { count: number; face_cents: number; by_price: [number, number][] };

export async function paidSales(db: any, eventIds: string[]): Promise<Record<string, PaidSales>> {
  const out: Record<string, PaidSales> = {};
  if (!eventIds.length) return out;
  const { data: types } = await db.from("ticket_types").select("id").in("event_id", eventIds).in("slug", ["test", "artist"]);
  const skip = new Set((types || []).map((t: any) => t.id));
  const { data: tix } = await db.from("tickets").select("order_id,event_id,type_id,unit_cents").in("event_id", eventIds).eq("status", "valid").eq("is_comp", false);
  const rows = (tix || []).filter((t: any) => !skip.has(t.type_id));
  const orderIds = [...new Set(rows.map((t: any) => t.order_id))] as string[];
  const paid = new Set<string>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data } = await db.from("ticket_orders").select("id").in("id", orderIds.slice(i, i + 200)).eq("status", "paid");
    (data || []).forEach((o: any) => paid.add(o.id));
  }
  const hist: Record<string, Record<number, number>> = {};
  for (const t of rows) {
    if (!paid.has(t.order_id)) continue;
    const c = Math.max(0, Math.round(Number(t.unit_cents) || 0));
    const h = (hist[t.event_id] ||= {});
    h[c] = (h[c] || 0) + 1;
  }
  for (const id of Object.keys(hist)) {
    const by = Object.entries(hist[id]).map(([c, n]) => [Number(c), n] as [number, number]);
    out[id] = { count: by.reduce((a, [, n]) => a + n, 0), face_cents: by.reduce((a, [c, n]) => a + c * n, 0), by_price: by };
  }
  return out;
}
