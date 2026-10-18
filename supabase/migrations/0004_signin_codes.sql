-- 6-digit email sign-in codes for members on a new phone. Only a hash is stored;
-- a code lasts 10 minutes, works once, and locks after 5 wrong tries.
-- RLS on with no policies: only the service role (inside functions) touches it.
create table if not exists public.signin_codes (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists signin_codes_subscriber_idx on public.signin_codes (subscriber_id, created_at desc);
alter table public.signin_codes enable row level security;
