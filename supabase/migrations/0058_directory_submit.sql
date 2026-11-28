-- Easy show submit flow (/shows-send). PR ONLY: nothing in this repo applies migrations. Run it by hand.
-- Adds the optional promo fields and the one-time edit links to the directory.
-- RLS stays on with NO policies. Only the service role inside the directory function reads or writes.
-- Nothing here touches events, tickets, checkout or the underground show.

alter table public.directory_listings
  add column if not exists lineup text,
  add column if not exists price text,
  add column if not exists sounds text[] not null default '{}',
  add column if not exists artist_socials text,
  add column if not exists promoter_ig text,
  add column if not exists age text check (age is null or age in ('all','18','21')),
  add column if not exists secret_reveal_at timestamptz,
  add column if not exists public_flyer_path text,
  add column if not exists source text not null default 'manual' check (source in ('link','flyer','manual')),
  add column if not exists was_live boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- Magic links (kind link, 7 days, works once) and the short edit sessions they open (kind session).
-- Only a hash of the token is stored.
create table if not exists public.directory_links (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.directory_listings(id) on delete cascade,
  kind text not null check (kind in ('link', 'session')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists directory_links_listing_idx on public.directory_links (listing_id, kind, created_at desc);

alter table public.directory_links enable row level security;
revoke all on table public.directory_links from anon, authenticated, public;
