-- Artist selling, round 2: short-link taps, "you sold one" alerts, and a staff-only milestone per show.
-- RLS on with no policies, like every table here: only the service role (inside functions) touches these.
create table if not exists public.artist_clicks (
  id bigserial primary key,
  invite_id uuid not null references public.artist_invites(id) on delete cascade,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists artist_clicks_invite_idx on public.artist_clicks (invite_id, created_at);
alter table public.artist_clicks enable row level security;

create table if not exists public.artist_sale_alerts (
  order_id uuid primary key references public.ticket_orders(id) on delete cascade,
  invite_id uuid not null references public.artist_invites(id) on delete cascade,
  sent_at timestamptz
);
alter table public.artist_sale_alerts enable row level security;

alter table public.artist_invites add column if not exists sales_alerts boolean not null default true;
-- Staff-only: flag artists who reach this many credited tickets. Never shown to artists.
alter table public.events add column if not exists artist_milestone integer;

-- Every 5 minutes, ask artist-sales to email artists about newly credited sales (same pattern as email-runner).
create or replace function public.run_artist_alerts() returns void language plpgsql security definer set search_path = public as $$
declare
  url text := (select value #>> '{}' from public.settings where key = 'functions_url') || '/artist-sales?a=notify';
  secret text := (select value #>> '{}' from public.settings where key = 'runner_secret');
begin
  if url is null or secret is null then return; end if;
  perform net.http_post(url := url, headers := jsonb_build_object('x-runner-secret', secret, 'Content-Type', 'application/json'), body := '{}'::jsonb);
end $$;
revoke all on function public.run_artist_alerts() from public, anon, authenticated;
select cron.schedule('artist-alerts', '*/5 * * * *', 'select public.run_artist_alerts()')
  where not exists (select 1 from cron.job where jobname = 'artist-alerts');
