-- Subduction platform, Phase 2 step 1: company accounts.
-- Every show, order and staff login belongs to a company, and each company sees only its own data.
-- Additive only: new tables and nullable/defaulted columns. Nothing existing is renamed or dropped,
-- so the live T.O.F.T.U. checkout, door app and emails keep working exactly as they do today.
-- RLS on, no policies, like every other table: only the functions (service role) touch these.

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null,
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  contact_email citext,
  -- Stripe Connect (Standard account, direct charges). Null until the promoter connects.
  stripe_account_id text unique check (stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]{6,}$'),
  stripe_charges_enabled boolean not null default false,
  stripe_details_submitted boolean not null default false,
  -- true = sells through the platform's own Stripe key, the way T.O.F.T.U. always has.
  legacy_stripe boolean not null default false,
  -- Subduction's fee per paid ticket, in cents. Null = the platform default (settings.platform_fee_cents).
  platform_fee_cents int check (platform_fee_cents is null or platform_fee_cents between 0 and 1000),
  approved_at timestamptz,
  approved_by citext,
  created_at timestamptz not null default now()
);

-- Who can run a company's shows. Staff sign in with the same emailed code as everyone else.
create table if not exists public.company_staff (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  unique (company_id, subscriber_id)
);
create index if not exists company_staff_subscriber on public.company_staff (subscriber_id);

alter table public.companies enable row level security;
alter table public.company_staff enable row level security;

-- Shows belong to a company and go through Dylan's approval before going on sale.
alter table public.events add column if not exists company_id uuid references public.companies(id);
alter table public.events add column if not exists review_status text not null default 'approved'
  check (review_status in ('draft','submitted','approved','rejected'));
alter table public.events add column if not exists review_note text;
-- The brand kit for the page template (logo, art, flyers, colours, font). Filled by the asset form (step 3).
alter table public.events add column if not exists theme jsonb not null default '{}';
create index if not exists events_company on public.events (company_id);

-- Orders remember which company and which Stripe account the money went to, and Subduction's cut.
alter table public.ticket_orders add column if not exists company_id uuid references public.companies(id);
alter table public.ticket_orders add column if not exists stripe_account_id text;
alter table public.ticket_orders add column if not exists platform_fee_cents int not null default 0;
create index if not exists ticket_orders_company on public.ticket_orders (company_id, status);

-- The platform's default fee lives in settings.platform_fee_cents, set from the chat when this is
-- applied (no prices in the repo). Until it's set, Connect checkouts refuse to open rather than
-- silently charging no fee.

-- Company #1: the shows Dylan already runs (T.O.F.T.U. and everything before it).
-- legacy_stripe keeps them on the current Stripe account with no Subduction fee, so nothing changes for buyers.
insert into public.companies (slug, name, status, legacy_stripe, platform_fee_cents, approved_at, approved_by)
values ('quantum', 'Quantum Productions', 'active', true, 0, now(), 'migration')
on conflict (slug) do nothing;

update public.events set company_id = (select id from public.companies where slug = 'quantum')
where company_id is null;
update public.ticket_orders o set company_id = e.company_id
from public.events e where o.event_id = e.id and o.company_id is null;

-- Everyone on the current staff list becomes an owner of company #1.
insert into public.company_staff (company_id, subscriber_id, role)
select (select id from public.companies where slug = 'quantum'), s.id, 'owner'
from public.subscribers s
where lower(s.email) in (select lower(jsonb_array_elements_text(value)) from public.settings where key = 'admin_emails')
on conflict (company_id, subscriber_id) do nothing;

-- New orders pick up their company from the show automatically, so the existing checkout code
-- (which doesn't know about companies) still tags every order correctly.
create or replace function public.ticket_order_company() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.company_id is null then
    select company_id into new.company_id from events where id = new.event_id;
  end if;
  return new;
end $$;
revoke all on function public.ticket_order_company() from public, anon, authenticated;
drop trigger if exists ticket_order_company on ticket_orders;
create trigger ticket_order_company before insert on ticket_orders
for each row execute function public.ticket_order_company();
