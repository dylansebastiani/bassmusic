-- Tracked links for flyers, posters, handbills and anything else that isn't an artist.
-- subduction.art/go/<tag> counts the scan or tap, then sends them to the show with ?ref=<tag>, so the
-- ticket sale is credited to the link too. Read by artist-sales only; checkout, tickets and emails untouched.
-- RLS on with no policies, like every table here: only the service role (inside functions) touches these.
create table if not exists public.track_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  tag text not null,
  label text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists track_links_tag_idx on public.track_links (lower(tag));
create index if not exists track_links_event_idx on public.track_links (event_id);
alter table public.track_links enable row level security;

create table if not exists public.track_clicks (
  id bigserial primary key,
  link_id uuid not null references public.track_links(id) on delete cascade,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists track_clicks_link_idx on public.track_clicks (link_id, created_at);
alter table public.track_clicks enable row level security;

-- The two T.O.F.T.U. flyers (Fri Jan 8 and Sat Jan 9).
insert into public.track_links (event_id, tag, label)
select e.id, v.tag, v.label from public.events e
cross join (values ('flyerfri', 'Friday flyer QR'), ('flyersat', 'Saturday flyer QR')) as v(tag, label)
where e.slug = 'underground'
on conflict do nothing;
