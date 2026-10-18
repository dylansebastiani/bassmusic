-- Collection: every track has its own QR code; scanning it drops the track into the
-- member's collection. Scans are logged per track so each artist can be measured.
-- Coupons and event details live here too. RLS on, no policies: only the service
-- role (inside functions) reads or writes.

alter table public.drops
  add column if not exists artist_slug text,
  add column if not exists description text,
  add column if not exists qr_code text unique,
  add column if not exists qr_active boolean not null default true;

alter table public.events
  add column if not exists description text,
  add column if not exists kind text not null default 'show' check (kind in ('show','popup','drop','other')),
  add column if not exists ends_at timestamptz,
  add column if not exists address text,
  add column if not exists ticket_url text,
  add column if not exists is_public boolean not null default true;

create table if not exists public.collection_items (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  drop_id uuid not null references public.drops(id) on delete cascade,
  event_id uuid references public.events(id),
  unlocked_at timestamptz not null default now(),
  unique (subscriber_id, drop_id)
);
create index if not exists collection_items_sub on public.collection_items(subscriber_id, unlocked_at desc);

-- One row per QR page view or unlock. No IPs, no emails: only ids.
create table if not exists public.track_scans (
  id bigint generated always as identity primary key,
  drop_id uuid not null references public.drops(id) on delete cascade,
  subscriber_id uuid references public.subscribers(id) on delete set null,
  event_id uuid references public.events(id),
  outcome text not null check (outcome in ('view','unlocked','already')),
  created_at timestamptz not null default now()
);
create index if not exists track_scans_drop on public.track_scans(drop_id, outcome, created_at desc);

-- Codes members can use in the shop later. min_tracks > 0 keeps the code hidden
-- until the member has that many tracks in their collection.
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  description text,
  url text,
  min_tracks int not null default 0,
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.collection_items enable row level security;
alter table public.track_scans enable row level security;
alter table public.coupons enable row level security;
