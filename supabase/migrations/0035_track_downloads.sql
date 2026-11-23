-- Fans who downloaded an artist's free track. The fan gives name, email, phone and ZIP once
-- (their phone remembers it), and every download is recorded here for the artist and the promoter.
create table if not exists public.track_downloads (
  id uuid primary key default gen_random_uuid(),
  track_id uuid references public.playlist_tracks(id) on delete set null,
  invite_id uuid references public.artist_invites(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  track_title text,
  name text not null,
  email text not null,
  phone text,
  zip text,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists track_downloads_invite on public.track_downloads(invite_id, created_at desc);
create index if not exists track_downloads_event on public.track_downloads(event_id, created_at desc);
alter table public.track_downloads enable row level security;
