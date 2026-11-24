-- Shared night capacity + night-linked pricing. Only switches on for a show whose nights have
-- ticket_nights.capacity set; every other show goes through the exact same code as before.
--   * A night holds `capacity` sold tickets. Comps (artists, guest list) and the "test" type never count.
--   * One-night tickets price by how full their night is (their tier ladder, indexed by night fill).
--   * A ticket type with linked_discount_cents set (the 2-day pass) costs each of its nights' current
--     one-night price added up, minus that discount; max_qty caps how many of it can sell.
--   Prices stay in the database, never in the repo.
alter table public.ticket_types add column if not exists linked_discount_cents int;
alter table public.ticket_types add column if not exists max_qty int;

create or replace function public.night_fill(p_night uuid) returns int
language sql stable set search_path to 'public', 'extensions' as $$
  select coalesce((select count(*) from public.tickets t join public.ticket_types y on y.id = t.type_id
                   where p_night = any(y.night_ids) and y.slug <> 'test' and t.status = 'valid' and not t.is_comp), 0)::int
       + coalesce((select sum((i->>'qty')::int) from public.ticket_orders o, jsonb_array_elements(o.items) i
                   join public.ticket_types y on y.id = (i->>'type_id')::uuid
                   where o.status = 'pending' and o.hold_until > now() and p_night = any(y.night_ids) and y.slug <> 'test'), 0)::int
$$;

-- Where position `pos` (0-based) falls on a tier ladder: {name, price_cents, left, next}, or null past the end.
create or replace function public.tier_at(p_tiers jsonb, p_pos int) returns jsonb
language plpgsql immutable as $$
declare t jsonb; s int := 0; e int; found jsonb;
begin
  for t in select * from jsonb_array_elements(coalesce(p_tiers, '[]')) loop
    e := s + (t->>'qty')::int;
    if found is not null then return found || jsonb_build_object('next', jsonb_build_object('name', t->>'name', 'price_cents', (t->>'price_cents')::int)); end if;
    if p_pos < e then found := jsonb_build_object('name', t->>'name', 'price_cents', (t->>'price_cents')::int, 'left', e - p_pos, 'next', null); end if;
    s := e;
  end loop;
  return found;
end $$;

-- The one-night ticket for a night (its ladder sets that night's current price).
create or replace function public.night_day_type(p_night uuid) returns uuid
language sql stable set search_path to 'public', 'extensions' as $$
  select id from public.ticket_types where night_ids = array[p_night] and slug <> 'test'
    and jsonb_array_length(tiers) > 0 order by on_sale desc, sort limit 1
$$;

-- What one more ticket of this type costs right now on a capped show, and how many are left.
-- p_extra: {night_id: n} tickets already taken in the same order. Null when the show isn't capped.
create or replace function public.capped_quote(p_type uuid, p_extra jsonb default '{}', p_extra_type int default 0) returns jsonb
language plpgsql stable set search_path to 'public', 'extensions' as $$
declare tt record; n record; fill int; lft int := null; price int := 0; q jsonb; dt uuid; tier_name text; tier_left int := null; nxt jsonb := null;
begin
  select * into tt from public.ticket_types where id = p_type;
  if tt is null or not exists (select 1 from public.ticket_nights where event_id = tt.event_id and capacity is not null) then return null; end if;
  for n in select id, capacity from public.ticket_nights where id = any(tt.night_ids) loop
    fill := public.night_fill(n.id) + coalesce((p_extra->>n.id::text)::int, 0);
    if n.capacity is not null then lft := least(coalesce(lft, n.capacity - fill), n.capacity - fill); end if;
    if tt.linked_discount_cents is not null then
      dt := public.night_day_type(n.id);
      q := public.tier_at((select tiers from public.ticket_types where id = dt), fill);
      if q is null then return jsonb_build_object('sold_out', true, 'left', 0); end if;
      price := price + (q->>'price_cents')::int;
    end if;
  end loop;
  if tt.linked_discount_cents is not null then
    price := price - tt.linked_discount_cents; tier_name := tt.name;
    if tt.max_qty is not null then lft := least(coalesce(lft, tt.max_qty), tt.max_qty - public.ticket_type_taken(tt.id) - p_extra_type); end if;
  elsif array_length(tt.night_ids, 1) = 1 and exists (select 1 from public.ticket_nights where id = tt.night_ids[1] and capacity is not null) then
    q := public.tier_at(tt.tiers, public.night_fill(tt.night_ids[1]) + coalesce((p_extra->>tt.night_ids[1]::text)::int, 0));
    if q is null then return jsonb_build_object('sold_out', true, 'left', 0); end if;
    price := (q->>'price_cents')::int; tier_name := q->>'name'; tier_left := least((q->>'left')::int, lft); nxt := q->'next';
  else
    q := public.tier_at(tt.tiers, public.ticket_type_taken(tt.id) + p_extra_type);
    if q is null then return jsonb_build_object('sold_out', true, 'left', 0); end if;
    price := (q->>'price_cents')::int; tier_name := q->>'name'; tier_left := (q->>'left')::int; nxt := q->'next';
    lft := least(coalesce(lft, tier_left), (select coalesce(sum((x->>'qty')::int), 0) from jsonb_array_elements(tt.tiers) x)::int - public.ticket_type_taken(tt.id) - p_extra_type);
  end if;
  lft := greatest(0, coalesce(lft, 0));
  return jsonb_build_object('sold_out', lft <= 0, 'left', lft,
    'tier', case when lft > 0 then jsonb_build_object('name', tier_name, 'price_cents', price, 'left', coalesce(least(tier_left, lft), lft)) end,
    'next_tier', case when lft > 0 then nxt end);
end $$;

create or replace function public.ticket_hold(p_event uuid, p_want jsonb, p_email text, p_name text, p_promo text, p_ref text, p_minutes integer default 35)
 returns uuid language plpgsql set search_path to 'public', 'extensions' as $function$
declare
  ev record; w jsonb; tt record; taken int; want int; left_in_tier int; take int;
  tier jsonb; tier_start int; tier_end int; items jsonb := '[]'; sub int := 0; n_total int := 0;
  pr record; pid uuid; disc int := 0; oid uuid;
  capped boolean; extra jsonb := '{}'; q jsonb; k int; nid uuid; got int; idx int; it jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('tickets:' || p_event::text));
  select * into ev from public.events where id = p_event;
  if ev is null or not ev.sales_open then raise exception 'Ticket sales aren''t open yet.'; end if;
  capped := exists (select 1 from public.ticket_nights where event_id = p_event and capacity is not null);

  for w in select * from jsonb_array_elements(p_want) loop
    want := coalesce((w->>'qty')::int, 0);
    if want <= 0 then continue; end if;
    select * into tt from public.ticket_types where id = (w->>'type_id')::uuid and event_id = p_event and on_sale;
    if tt is null then raise exception 'That ticket isn''t on sale.'; end if;

    if capped then
      -- One ticket at a time, so each one is priced by how full its nights are right then.
      got := 0;
      for k in 1..want loop
        q := public.capped_quote(tt.id, extra, got);
        if q is null or (q->>'sold_out')::boolean then raise exception '% only has % left.', tt.name, got; end if;
        idx := null;
        for i in 0 .. jsonb_array_length(items) - 1 loop
          it := items->i;
          if it->>'type_id' = tt.id::text and it->>'tier' = q->'tier'->>'name' and (it->>'unit_cents')::int = (q->'tier'->>'price_cents')::int then idx := i; end if;
        end loop;
        if idx is null then
          items := items || jsonb_build_object('type_id', tt.id, 'name', tt.name, 'tier', q->'tier'->>'name', 'unit_cents', (q->'tier'->>'price_cents')::int, 'qty', 1);
        else
          items := jsonb_set(items, array[idx::text, 'qty'], to_jsonb((items->idx->>'qty')::int + 1));
        end if;
        sub := sub + (q->'tier'->>'price_cents')::int; n_total := n_total + 1; got := got + 1;
        foreach nid in array tt.night_ids loop
          extra := jsonb_set(extra, array[nid::text], to_jsonb(coalesce((extra->>nid::text)::int, 0) + 1));
        end loop;
      end loop;
      continue;
    end if;

    -- Not capped: unchanged from before.
    taken := public.ticket_type_taken(tt.id);
    tier_start := 0;
    for tier in select * from jsonb_array_elements(tt.tiers) loop
      exit when want = 0;
      tier_end := tier_start + (tier->>'qty')::int;
      left_in_tier := greatest(0, tier_end - greatest(taken, tier_start));
      take := least(left_in_tier, want);
      if take > 0 then
        items := items || jsonb_build_object('type_id', tt.id, 'name', tt.name, 'tier', tier->>'name',
                                             'unit_cents', (tier->>'price_cents')::int, 'qty', take);
        sub := sub + take * (tier->>'price_cents')::int;
        want := want - take; taken := taken + take; n_total := n_total + take;
      end if;
      tier_start := tier_end;
    end loop;
    if want > 0 then raise exception '% only has % left.', tt.name, ((w->>'qty')::int - want); end if;
  end loop;

  if n_total = 0 then raise exception 'Pick at least one ticket.'; end if;
  if n_total > ev.max_per_order then raise exception 'Max % tickets per order.', ev.max_per_order; end if;

  if p_promo is not null and length(p_promo) > 0 then
    select * into pr from public.promo_codes where event_id = p_event and code = p_promo::citext and active;
    if pr is null then raise exception 'That code doesn''t work.'; end if;
    if pr.max_uses is not null and (select count(*) from public.ticket_orders
        where promo_id = pr.id and (status = 'paid' or (status = 'pending' and hold_until > now()))) >= pr.max_uses then
      raise exception 'That code has been used up.';
    end if;
    disc := least(sub, pr.discount_cents * n_total); pid := pr.id;
  end if;

  insert into public.ticket_orders (event_id, status, email, name, items, subtotal_cents, discount_cents, total_cents,
                                    promo_id, ref, hold_until)
  values (p_event, 'pending', p_email, p_name, items, sub, disc, sub - disc, pid, p_ref, now() + make_interval(mins => p_minutes))
  returning id into oid;
  return oid;
end $function$;
