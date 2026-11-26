-- Named street-team links for a promoter show. ?ref=djname is stored on the order already.
-- This table names that code and, if the promoter wants, a payout per paid ticket.
-- The payout is a note of what the promoter owes. Subduction does not move that money.
-- The live show cannot have a row here.

create table if not exists public.street_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  event_id uuid not null references public.events(id) on delete cascade,
  code text not null,
  label text not null,
  payout_cents int,
  created_at timestamptz not null default now(),
  unique (event_id, code),
  check (code ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  check (char_length(label) between 1 and 60),
  check (payout_cents is null or payout_cents between 0 and 100000)
);
create index if not exists street_links_company on public.street_links (company_id);
alter table public.street_links enable row level security;

create or replace function public.street_link_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare s text; legacy boolean; cslug text;
begin
  if new.event_id = '63b511f3-d838-404f-9c2e-5d4b98fbf013'::uuid then
    raise exception 'street link cannot attach to the live show';
  end if;
  select e.slug, c.legacy_stripe, c.slug into s, legacy, cslug
  from public.events e
  join public.companies c on c.id = e.company_id
  where e.id = new.event_id;
  if s is null or s = 'underground' or legacy or cslug = 'quantum' then
    raise exception 'street link cannot attach to the live show';
  end if;
  if new.company_id is distinct from (select company_id from public.events where id = new.event_id) then
    raise exception 'street link cannot attach to the live show';
  end if;
  return new;
end $$;
revoke all on function public.street_link_guard() from public, anon, authenticated;
drop trigger if exists street_link_guard on public.street_links;
create trigger street_link_guard before insert or update on public.street_links
for each row execute function public.street_link_guard();
