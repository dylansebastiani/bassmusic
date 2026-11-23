-- Tracks that booked artists add to a show's playlist from their artist pass page.
-- They go straight into rotation on the show's page. free_download is the artist's own choice per track.
create table if not exists public.playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  invite_id uuid not null references public.artist_invites(id) on delete cascade,
  path text not null unique,
  title text not null,
  artist text,
  free_download boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists playlist_tracks_event on public.playlist_tracks(event_id);
alter table public.playlist_tracks enable row level security;
