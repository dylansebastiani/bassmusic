-- Artist invites. Staff make one per artist with a number of guest spots and text them the
-- private link (artist.html?k=<token>). The artist adds their email there, which issues their
-- gold Artist Pass (both nights, free, never sold) and makes them a member; then the same page
-- runs their own guest list. RLS on, no policies: only the artist function (service role) touches it.
create table if not exists public.artist_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id),
  name text not null,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  guest_spots int not null default 2 check (guest_spots between 0 and 50),
  email text,
  phone text,
  order_id uuid references ticket_orders(id),
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references subscribers(id),
  created_at timestamptz not null default now()
);
alter table public.artist_invites enable row level security;
create index if not exists artist_invites_event on public.artist_invites(event_id);

-- Which artist an order belongs to (their own pass, or a guest they added).
alter table public.ticket_orders add column if not exists artist_invite_id uuid references artist_invites(id);
create index if not exists ticket_orders_artist on public.ticket_orders(artist_invite_id) where artist_invite_id is not null;

-- The Artist Pass ticket type for T.O.F.T.U.: both nights, not on sale, no tiers.
insert into ticket_types (event_id, slug, name, blurb, night_ids, tiers, on_sale, sort)
select e.id, 'artist', 'Artist Pass', 'Artists only', array(select n.id from ticket_nights n where n.event_id = e.id order by n.sort), '[]'::jsonb, false, 99
from events e where e.slug = 'underground'
  and not exists (select 1 from ticket_types t where t.event_id = e.id and t.slug = 'artist');

-- Members from tickets: label artists and their guests by where they came from.
create or replace function public.ticket_order_member() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare s_id uuid; existing_id uuid; first text; code text; i int := 0; src text;
begin
  if new.status not in ('paid', 'comp') or new.email is null then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  begin
    first := nullif(split_part(btrim(coalesce(new.name, '')), ' ', 1), '');
    src := case
      when new.artist_invite_id is not null and exists (select 1 from artist_invites a where a.id = new.artist_invite_id and a.order_id = new.id) then 'artist'
      when new.status = 'comp' then 'guestlist' else 'tickets' end;
    select id into existing_id from subscribers where email = lower(new.email);
    if existing_id is null then
      loop
        code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
        exit when not exists (select 1 from subscribers where referral_code = code) or i > 5;
        i := i + 1;
      end loop;
      insert into subscribers (email, first_name, phone, source, event_id, referral_code, sms_consent)
      values (lower(new.email), first, new.phone, src, new.event_id, code, false)
      on conflict (email) do nothing
      returning id into s_id;
      if s_id is not null then
        insert into email_queue (subscriber_id, template_key, priority, send_after)
        values (s_id, 'welcome', 2, now() + interval '1 day');
      end if;
    else
      update subscribers set first_name = coalesce(first_name, first), phone = coalesce(phone, new.phone)
      where id = existing_id and status <> 'deleted';
    end if;
  exception when others then
    raise warning 'ticket_order_member: % (order %)', sqlerrm, new.id;
  end;
  return new;
end $$;
