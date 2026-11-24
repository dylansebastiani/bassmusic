-- One artist profile per person (per account), not per show. Seeded from their artist pass the first time,
-- and saved edits are copied onto every show they're booked on, so a booking is always already filled in.
-- The show's billing name (artist_invites.name) stays the promoter's: only the profile fields sync.
-- RLS on, no policies: only functions (service role) read or write it.
create table if not exists public.artist_profiles (
  subscriber_id uuid primary key references public.subscribers(id) on delete cascade,
  name text,
  bio text,
  hometown text,
  genre text,
  links jsonb not null default '{}'::jsonb,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.artist_profiles enable row level security;
