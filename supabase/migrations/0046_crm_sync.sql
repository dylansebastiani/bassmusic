-- Brevo contacts stay in sync on their own: each person is marked once they're in Brevo, and a timer
-- calls the crm-sync function every 10 minutes to add whoever is new (see crm-sync/index.ts).
alter table public.ticket_orders add column if not exists crm_synced_at timestamptz;
alter table public.artist_invites add column if not exists crm_synced_at timestamptz;
alter table public.artist_members add column if not exists crm_synced_at timestamptz;
alter table public.subscribers add column if not exists crm_synced_at timestamptz;
-- If someone changes their profile (phone, name), sync them again.
create or replace function public.crm_resync_subscriber() returns trigger language plpgsql as $$
begin
  if (new.first_name, new.phone, new.zip, new.sms_consent) is distinct from (old.first_name, old.phone, old.zip, old.sms_consent) then new.crm_synced_at := null; end if;
  return new;
end $$;
drop trigger if exists crm_resync on public.subscribers;
create trigger crm_resync before update on public.subscribers for each row execute function public.crm_resync_subscriber();

create or replace function public.run_crm_sync() returns void language plpgsql security definer set search_path to 'public' as $$
declare
  url text := (select value #>> '{}' from public.settings where key = 'functions_url') || '/crm-sync?a=run';
  secret text := (select value #>> '{}' from public.settings where key = 'runner_secret');
begin
  if url is null or secret is null then return; end if;
  perform net.http_post(url := url, headers := jsonb_build_object('x-runner-secret', secret, 'Content-Type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 120000);
end $$;
revoke all on function public.run_crm_sync() from public, anon, authenticated;
select cron.unschedule('crm-sync') where exists (select 1 from cron.job where jobname = 'crm-sync');
select cron.schedule('crm-sync', '*/10 * * * *', 'select public.run_crm_sync()');
