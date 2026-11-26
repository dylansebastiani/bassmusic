-- Promoter referral credit.
-- Each promoter company gets a code. A crew that signs up through that code is linked here.
-- When that crew runs a show, the referrer is owed a share of Subduction's buyer fee
-- on paid tickets. The share and how many shows count live in settings, so the first show
-- today can become the first 3 shows later without another migration.
-- Nothing in this file moves money, changes a ticket price, or touches the live show.

alter table public.companies add column if not exists referral_code text;
alter table public.promoter_leads add column if not exists referral_code text;
alter table public.demo_leads add column if not exists referral_code text;

-- Codes for crews that sell on their own Stripe account. The original account stays null.
do $$
declare r record; c text; tries int;
begin
  for r in select id from public.companies where legacy_stripe = false and slug <> 'quantum' and referral_code is null loop
    tries := 0;
    loop
      tries := tries + 1;
      if tries > 20 then raise exception 'could not mint a referral code'; end if;
      c := substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8);
      exit when not exists (select 1 from public.companies where referral_code = c);
    end loop;
    update public.companies set referral_code = c where id = r.id and referral_code is null;
  end loop;
end $$;

create unique index if not exists companies_referral_code_key on public.companies (referral_code) where referral_code is not null;
alter table public.companies drop constraint if exists companies_referral_code_fmt;
alter table public.companies add constraint companies_referral_code_fmt
  check (referral_code is null or referral_code ~ '^[a-z0-9]{8}$');

create or replace function public.companies_set_referral_code()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare tries int := 0;
begin
  if new.legacy_stripe or new.slug = 'quantum' then
    new.referral_code := null;
    return new;
  end if;
  if new.referral_code is not null then
    return new;
  end if;
  loop
    tries := tries + 1;
    if tries > 20 then raise exception 'could not mint a referral code'; end if;
    new.referral_code := substr(encode(gen_random_bytes(6), 'hex'), 1, 8);
    exit when not exists (select 1 from public.companies where referral_code = new.referral_code);
  end loop;
  return new;
end $$;
revoke all on function public.companies_set_referral_code() from public, anon, authenticated;
drop trigger if exists companies_set_referral_code on public.companies;
create trigger companies_set_referral_code before insert on public.companies
for each row execute function public.companies_set_referral_code();

-- One referrer per crew. The link is written once, when the crew account is created.
create table if not exists public.promoter_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_company_id uuid not null references public.companies(id),
  referred_company_id uuid not null unique references public.companies(id),
  code text not null,
  created_at timestamptz not null default now(),
  check (referrer_company_id <> referred_company_id),
  check (code ~ '^[a-z0-9]{8}$')
);
create index if not exists promoter_referrals_referrer on public.promoter_referrals (referrer_company_id);

-- One row per referred show. status pending until Dylan marks it paid. settled rows are not rewritten.
create table if not exists public.promoter_referral_credits (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.promoter_referrals(id),
  event_id uuid not null references public.events(id),
  show_rank int not null check (show_rank between 1 and 12),
  paid_tickets int not null default 0 check (paid_tickets >= 0),
  fee_cents int not null default 0 check (fee_cents >= 0),
  credit_cents int not null default 0 check (credit_cents >= 0),
  status text not null default 'pending' check (status in ('pending', 'settled', 'void')),
  note text,
  settled_at timestamptz,
  settled_by uuid references public.subscribers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (referral_id, event_id)
);
create index if not exists promoter_referral_credits_status on public.promoter_referral_credits (status, updated_at);

alter table public.promoter_referrals enable row level security;
alter table public.promoter_referral_credits enable row level security;

-- Hard stop. The live show and the original Stripe account cannot earn or owe this credit.
create or replace function public.promoter_referral_credit_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare s text;
begin
  if new.event_id = '63b511f3-d838-404f-9c2e-5d4b98fbf013'::uuid then
    raise exception 'referral credit cannot attach to the live show';
  end if;
  select slug into s from public.events where id = new.event_id;
  if s is null or s = 'underground' then
    raise exception 'referral credit cannot attach to the live show';
  end if;
  if exists (
    select 1 from public.events e
    join public.companies c on c.id = e.company_id
    where e.id = new.event_id and (c.legacy_stripe or c.slug = 'quantum')
  ) then
    raise exception 'referral credit cannot attach to the original account';
  end if;
  return new;
end $$;
revoke all on function public.promoter_referral_credit_guard() from public, anon, authenticated;
drop trigger if exists promoter_referral_credit_guard on public.promoter_referral_credits;
create trigger promoter_referral_credit_guard before insert or update on public.promoter_referral_credits
for each row execute function public.promoter_referral_credit_guard();

-- Link a new crew to the promoter whose code they used. Safe to call twice.
-- A crew cannot refer itself. The original account is never a referrer or a referral.
create or replace function public.attach_promoter_referral(p_company uuid, p_email text, p_code text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_legacy boolean;
  v_slug text;
  v_lead text;
  v_demo text;
  cand text;
  v_referrer uuid;
begin
  if p_company is null then return; end if;
  select legacy_stripe, slug into v_legacy, v_slug from public.companies where id = p_company;
  if v_legacy is null or v_legacy or v_slug = 'quantum' then return; end if;
  if exists (select 1 from public.promoter_referrals where referred_company_id = p_company) then return; end if;

  if v_code !~ '^[a-z0-9]{8}$' then v_code := null; end if;
  if v_email <> '' then
    select referral_code into v_lead from public.promoter_leads where lower(email) = v_email limit 1;
    select referral_code into v_demo from public.demo_leads where lower(email) = v_email order by created_at desc limit 1;
  end if;

  for cand in select t.x from (values (v_code), (lower(coalesce(v_lead, ''))), (lower(coalesce(v_demo, '')))) as t(x) loop
    if cand is null or cand !~ '^[a-z0-9]{8}$' then continue; end if;
    select id into v_referrer from public.companies
      where referral_code = cand and legacy_stripe = false and slug <> 'quantum' and id <> p_company;
    if v_referrer is null then continue; end if;
    if v_email <> '' and exists (
      select 1 from public.companies where id = v_referrer and lower(contact_email::text) = v_email
    ) then return; end if;
    if v_email <> '' and exists (
      select 1 from public.company_staff cs
      join public.subscribers s on s.id = cs.subscriber_id
      where cs.company_id = v_referrer and lower(s.email::text) = v_email
    ) then return; end if;
    insert into public.promoter_referrals (referrer_company_id, referred_company_id, code)
    values (v_referrer, p_company, cand)
    on conflict (referred_company_id) do nothing;
    return;
  end loop;
end $$;
revoke all on function public.attach_promoter_referral(uuid, text, text) from public, anon, authenticated;
grant execute on function public.attach_promoter_referral(uuid, text, text) to service_role;

-- 5000 means half of the buyer fee already stored on the order. 1 means the earliest show only.
insert into public.settings (key, value) values
  ('promoter_referral_show_limit', '1'::jsonb),
  ('promoter_referral_share_bps', '5000'::jsonb)
on conflict (key) do nothing;
