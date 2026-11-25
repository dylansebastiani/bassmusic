-- More than one person under one artist name (a duo like GEEZ). The act (artist_invites) keeps the shared
-- profile, guest spots (one pool), sell link and tracks. Each extra member gets their own Artist Pass and
-- their own private link (artist.html?k=<member token>) that opens the same act page.
create table if not exists public.artist_members (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.artist_invites(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text not null,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  order_id uuid references public.ticket_orders(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists artist_members_invite on public.artist_members(invite_id);
alter table public.artist_members enable row level security;
