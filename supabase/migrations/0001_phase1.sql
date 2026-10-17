-- The Stack: fan membership schema. RLS on everywhere, no policies: only the
-- service role (Edge Functions) can read or write. The browser never touches these.
create extension if not exists citext;
create extension if not exists pgcrypto;

-- The first waitlist page wrote straight from the browser; that path is closed now.
drop policy if exists "anyone can join" on public.waitlist;
revoke all on public.waitlist from anon;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  venue text,
  city text,
  starts_at timestamptz,
  prize text,
  is_active boolean not null default true,
  winner_subscriber_id uuid,
  created_at timestamptz not null default now()
);

create table public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  first_name text,
  city text,
  zip text,
  phone text,
  sms_consent boolean not null default false,
  sms_consent_text text,
  sms_consent_at timestamptz,
  age_confirmed boolean,
  email_confirmed_at timestamptz,
  status text not null default 'active' check (status in ('active','unsubscribed','bounced','complained','sunset','deleted')),
  source text,
  event_id uuid references public.events(id),
  utm_source text, utm_medium text, utm_campaign text,
  variant text,
  referral_code text unique,
  referred_by uuid references public.subscribers(id),
  confirmed_referrals int not null default 0,
  unsubscribe_token uuid not null default gen_random_uuid(),
  access_token uuid not null default gen_random_uuid(),
  ip_hash text,
  user_agent text,
  birthday date,
  ig_handle text,
  country text default 'US',
  email_pref text not null default 'all',
  fan_score int not null default 0,
  fan_tier text not null default 'new',
  shows_attended int not null default 0,
  last_engaged_at timestamptz,
  created_at timestamptz not null default now()
);
create index subscribers_access_token on public.subscribers(access_token);
create index subscribers_unsub_token on public.subscribers(unsubscribe_token);
create index subscribers_referred_by on public.subscribers(referred_by);
alter table public.events add constraint events_winner_fk foreign key (winner_subscriber_id) references public.subscribers(id);

create table public.giveaway_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  subscriber_id uuid not null references public.subscribers(id),
  entries int not null default 1,
  created_at timestamptz not null default now(),
  unique (event_id, subscriber_id)
);

create table public.drops (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  artist text,
  audio_path text,
  artwork_path text,
  is_current boolean not null default false,
  is_bonus boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.email_queue (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id),
  template_key text not null,
  send_after timestamptz not null default now(),
  priority int not null default 5,
  status text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscriber_id, template_key)
);
create index email_queue_due on public.email_queue(status, priority, send_after);

create table public.page_views (
  id bigint generated always as identity primary key,
  path text,
  source text,
  event_slug text,
  variant text,
  created_at timestamptz not null default now()
);

create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id),
  tier text not null,
  granted_at timestamptz not null default now(),
  fulfilled boolean not null default false,
  note text
);

create table public.engagement_events (
  id bigint generated always as identity primary key,
  subscriber_id uuid not null references public.subscribers(id),
  type text not null,
  ref_id uuid,
  value numeric,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index engagement_sub on public.engagement_events(subscriber_id, type);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id),
  poll_key text not null,
  choice text not null,
  created_at timestamptz not null default now(),
  unique (subscriber_id, poll_key)
);

create table public.fan_tags (
  subscriber_id uuid not null references public.subscribers(id),
  tag text not null,
  source text,
  created_at timestamptz not null default now(),
  primary key (subscriber_id, tag)
);

-- subscribe() rate limit: one row per ip_hash per minute window
create table public.rate_limits (
  ip_hash text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (ip_hash, window_start)
);

-- Runtime config the email runner and reward tiers read (daily budget etc.)
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value) values
  ('email_daily_budget', '280'),
  ('referral_tiers', '[{"referrals":1,"tier":"entries_x2","label":"2 extra giveaway entries"},{"referrals":3,"tier":"guestlist_plus1","label":"Guaranteed guest list +1"},{"referrals":10,"tier":"merch","label":"Free merch item"}]'),
  ('functions_url', to_jsonb('https://hxfuelulxsituzcgsvhg.supabase.co/functions/v1'::text)),
  ('runner_secret', to_jsonb(encode(gen_random_bytes(24), 'hex'))),
  ('webhook_secret', to_jsonb(encode(gen_random_bytes(24), 'hex'))),
  ('ip_salt', to_jsonb(encode(gen_random_bytes(24), 'hex')));

alter table public.events enable row level security;
alter table public.subscribers enable row level security;
alter table public.giveaway_entries enable row level security;
alter table public.drops enable row level security;
alter table public.email_queue enable row level security;
alter table public.page_views enable row level security;
alter table public.rewards enable row level security;
alter table public.engagement_events enable row level security;
alter table public.votes enable row level security;
alter table public.fan_tags enable row level security;
alter table public.rate_limits enable row level security;
alter table public.settings enable row level security;

-- Belt and braces: even with RLS on, strip table grants from the public roles.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Private bucket for unreleased audio and artwork. Served only via signed URLs.
insert into storage.buckets (id, name, public) values ('drops', 'drops', false) on conflict (id) do nothing;

-- Atomic rate-limit bump: returns the count for this ip in the current minute.
create or replace function public.bump_rate_limit(p_ip_hash text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into rate_limits (ip_hash, window_start, count)
  values (p_ip_hash, date_trunc('minute', now()), 1)
  on conflict (ip_hash, window_start) do update set count = rate_limits.count + 1
  returning count into n;
  delete from rate_limits where window_start < now() - interval '10 minutes';
  return n;
end $$;
revoke all on function public.bump_rate_limit(text) from public, anon, authenticated;
