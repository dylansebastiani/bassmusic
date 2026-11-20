-- Ticketing: sell tickets for a show through Stripe, issue QR tickets, run a guest list,
-- scan at the door. RLS on, no policies, like every other table: only the functions touch it.
-- Prices and tiers live in these tables (set from the chat), never in the repo.

alter table public.events add column if not exists sales_open boolean not null default false;
alter table public.events add column if not exists age text;              -- "18+", "21+", "All ages" or null = TBA
alter table public.events add column if not exists poster_url text;
alter table public.events add column if not exists max_per_order int not null default 8;
alter table public.events add column if not exists door_pin_hash text;    -- door staff PIN, hashed

-- One row per night of a show. Lineup is an ordered list of {name, note}.
create table if not exists public.ticket_nights (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  slug text not null,
  label text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  lineup jsonb not null default '[]',
  sort int not null default 0,
  unique (event_id, slug)
);

-- What people buy. A ticket type gets you into one or more nights.
-- tiers: [{"name":"Early bird","price_cents":2800,"qty":30}, ...] sold in order, by count.
-- The type sells out when every tier is gone.
create table if not exists public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  slug text not null,
  name text not null,
  blurb text,
  night_ids uuid[] not null,
  tiers jsonb not null default '[]',
  door_price_cents int,
  on_sale boolean not null default true,
  sort int not null default 0,
  unique (event_id, slug)
);

-- Street team / promoter codes. discount_cents = 0 means tracking only.
create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  code citext not null,
  label text,
  discount_cents int not null default 0 check (discount_cents >= 0),
  max_uses int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, code)
);

-- An order holds its tickets while the buyer is in checkout (status pending until hold_until),
-- so two people can never both get the last early-bird ticket.
create table if not exists public.ticket_orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','paid','expired','refunded','comp')),
  email citext,
  name text,
  items jsonb not null default '[]',          -- [{type_id, tier, unit_cents, qty}]
  subtotal_cents int not null default 0,
  discount_cents int not null default 0,
  total_cents int not null default 0,
  promo_id uuid references public.promo_codes(id),
  ref text,
  comp_list text,                              -- whose guest list a comp is on
  stripe_session_id text unique,
  stripe_payment_intent text,
  hold_until timestamptz,
  emailed_at timestamptz,
  created_by uuid references public.subscribers(id),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists ticket_orders_event on public.ticket_orders (event_id, status);
create index if not exists ticket_orders_pi on public.ticket_orders (stripe_payment_intent);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ticket_orders(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  type_id uuid not null references public.ticket_types(id),
  code text unique not null,                   -- 8 chars, printed on the ticket, typeable at the door
  token text unique not null,                  -- long secret in the QR code and ticket link
  holder_name text,
  email citext,
  tier text,
  unit_cents int not null default 0,
  is_comp boolean not null default false,
  status text not null default 'valid' check (status in ('valid','void')),
  created_at timestamptz not null default now()
);
create index if not exists tickets_event on public.tickets (event_id, type_id, status);
create index if not exists tickets_name on public.tickets (event_id, lower(holder_name));

-- One scan per ticket per night. The unique key is what stops a ticket being used twice.
create table if not exists public.ticket_scans (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  night_id uuid not null references public.ticket_nights(id) on delete cascade,
  scanned_by text,
  scanned_at timestamptz not null default now(),
  unique (ticket_id, night_id)
);

create table if not exists public.door_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  token_hash text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.ticket_nights enable row level security;
alter table public.ticket_types enable row level security;
alter table public.promo_codes enable row level security;
alter table public.ticket_orders enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_scans enable row level security;
alter table public.door_sessions enable row level security;

-- Tickets counted against a type: issued and valid (comps don't count), plus live holds.
create or replace function public.ticket_type_taken(p_type uuid) returns int
language sql stable set search_path = public, extensions as $$
  select coalesce((select count(*) from public.tickets t where t.type_id = p_type and t.status = 'valid' and not t.is_comp), 0)::int
       + coalesce((select sum((i->>'qty')::int) from public.ticket_orders o, jsonb_array_elements(o.items) i
                   where o.status = 'pending' and o.hold_until > now() and (i->>'type_id')::uuid = p_type), 0)::int
$$;

-- Hold tickets and price them, atomically. p_want: [{"type_id":..., "qty":n}].
-- Each ticket is priced by its place in line: if 3 early-bird are left and you buy 5,
-- you pay early bird for 3 and the next tier for 2. Returns the new order row id,
-- or raises with a message the page can show.
create or replace function public.ticket_hold(p_event uuid, p_want jsonb, p_email text, p_name text,
                                              p_promo text, p_ref text, p_minutes int default 35)
returns uuid language plpgsql set search_path = public, extensions as $$
declare
  ev record; w jsonb; tt record; taken int; want int; left_in_tier int; take int;
  tier jsonb; tier_start int; tier_end int; items jsonb := '[]'; sub int := 0; n_total int := 0;
  pr record; pid uuid; disc int := 0; oid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('tickets:' || p_event::text));
  select * into ev from public.events where id = p_event;
  if ev is null or not ev.sales_open then raise exception 'Ticket sales aren''t open yet.'; end if;

  for w in select * from jsonb_array_elements(p_want) loop
    want := coalesce((w->>'qty')::int, 0);
    if want <= 0 then continue; end if;
    select * into tt from public.ticket_types where id = (w->>'type_id')::uuid and event_id = p_event and on_sale;
    if tt is null then raise exception 'That ticket isn''t on sale.'; end if;
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
end $$;

-- Turn a paid (or comp) order into tickets. Safe to call twice: tickets are made once.
create or replace function public.ticket_issue(p_order uuid, p_status text) returns int
language plpgsql set search_path = public, extensions as $$
declare o record; i jsonb; k int; n int := 0; alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text;
begin
  select * into o from public.ticket_orders where id = p_order for update;
  if o is null then return 0; end if;
  if exists (select 1 from public.tickets where order_id = p_order) then
    update public.ticket_orders set status = p_status, paid_at = coalesce(paid_at, now()) where id = p_order and status <> 'refunded';
    return 0;
  end if;
  for i in select * from jsonb_array_elements(o.items) loop
    for k in 1..(i->>'qty')::int loop
      loop
        c := '';
        for j in 1..8 loop c := c || substr(alpha, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 32), 1); end loop;
        exit when not exists (select 1 from public.tickets where code = c);
      end loop;
      insert into public.tickets (order_id, event_id, type_id, code, token, holder_name, email, tier, unit_cents, is_comp)
      values (p_order, o.event_id, (i->>'type_id')::uuid, c, encode(extensions.gen_random_bytes(24), 'hex'), o.name, o.email,
              i->>'tier', (i->>'unit_cents')::int, p_status = 'comp');
      n := n + 1;
    end loop;
  end loop;
  update public.ticket_orders set status = p_status, paid_at = now(), hold_until = null where id = p_order;
  return n;
end $$;

create index if not exists tickets_order on public.tickets (order_id);

-- Only the functions (service role) may call these; the public API key can't hold or issue tickets.
revoke execute on function public.ticket_type_taken(uuid) from public, anon, authenticated;
revoke execute on function public.ticket_hold(uuid, jsonb, text, text, text, text, int) from public, anon, authenticated;
revoke execute on function public.ticket_issue(uuid, text) from public, anon, authenticated;
grant execute on function public.ticket_type_taken(uuid) to service_role;
grant execute on function public.ticket_hold(uuid, jsonb, text, text, text, text, int) to service_role;
grant execute on function public.ticket_issue(uuid, text) to service_role;
