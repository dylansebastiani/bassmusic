-- Admin sign-in: an allow list of member emails (settings.admin_emails) and a session
-- table. Only a hash of the session token is stored. RLS on, no policies.
create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  token_hash text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.admin_sessions enable row level security;
insert into public.settings (key, value) values
  ('admin_emails', '["dylan.sebastiani@gmail.com"]'),
  ('brevo_list_id', 'null')
on conflict (key) do nothing;
