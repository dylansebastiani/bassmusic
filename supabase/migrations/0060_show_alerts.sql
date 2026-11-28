-- City show alerts (/shows and the city pages). PR ONLY: nothing in this repo applies migrations. Run it by hand.
-- A fan leaves an email for one city. When a new show for that city appears in the directory, the directory
-- function emails them once. Every email carries an unsubscribe link (the token below) and List-Unsubscribe headers.
-- RLS stays on with NO policies. Only the service role inside the directory function reads or writes.
-- Nothing here touches events, tickets, checkout or the underground show.

create extension if not exists citext;

-- One row per email per city. The unsubscribe link carries a token made from the row id and a server secret.
-- Only its hash is stored here (unsub_hash), the same rule as every other token. No raw IPs: ip_hash only.
create table if not exists public.show_alerts (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  city_path text not null check (city_path ~ '^[a-z0-9-]{1,48}$'),
  city_name text not null,
  unsub_hash text not null unique check (unsub_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text,
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  last_sent_at timestamptz,
  sent_count int not null default 0,
  unique (email, city_path)
);
create index if not exists show_alerts_city_idx on public.show_alerts (city_path) where unsubscribed_at is null;

-- Every show the alert sweep has seen. The first time a show appears it is inserted once (the unique key makes
-- sure only one sweep sends for it), then sent_at marks it done. Shows already listed on the first sweep are
-- recorded as baseline and never emailed.
create table if not exists public.show_alert_shows (
  show_key text primary key,
  city_path text not null,
  name text not null,
  first_date date,
  baseline boolean not null default false,
  first_seen_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_count int not null default 0
);

alter table public.show_alerts enable row level security;
alter table public.show_alert_shows enable row level security;
revoke all on table public.show_alerts from anon, authenticated, public;
revoke all on table public.show_alert_shows from anon, authenticated, public;
grant all on table public.show_alerts to service_role;
grant all on table public.show_alert_shows to service_role;
