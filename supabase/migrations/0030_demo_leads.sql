-- Promoters who walked through the demo show and asked for a test ticket. A sales lead list.
-- Its own table, touched by nothing else. RLS on with no policies: only the service role (inside the function) reads or writes.
create table if not exists public.demo_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  crew text,
  phone text,
  token text not null unique,
  code text not null,
  emailed_at timestamptz,
  opened_at timestamptz,
  scanned_at timestamptz,
  ip_hash text,
  created_at timestamptz not null default now()
);
alter table public.demo_leads enable row level security;
