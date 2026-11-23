-- Artists who want a Subduction artist page when that side ships.
-- Its own table, touched by nothing else. RLS on with no policies: only the service role (inside the function) reads or writes.
create table if not exists public.artist_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  artist_name text,
  ip_hash text,
  created_at timestamptz not null default now()
);
alter table public.artist_waitlist enable row level security;
