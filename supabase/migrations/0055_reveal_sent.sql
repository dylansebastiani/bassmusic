-- Address reveal email for promoter shows (the `reveal` function). Additive: one new column, one job.
-- T.O.F.T.U. is excluded in the function; its own reveal job (0016/0043) is untouched.
alter table public.events add column if not exists reveal_sent_at timestamptz;

create or replace function public.run_reveal() returns void language plpgsql security definer set search_path to 'public' as $$
declare
  url text := (select value #>> '{}' from public.settings where key = 'functions_url') || '/reveal';
  secret text := (select value #>> '{}' from public.settings where key = 'runner_secret');
begin
  if url is null or secret is null then return; end if;
  -- Only call out when some promoter show is actually due.
  if not exists (select 1 from public.events where location_secret and reveal_sent_at is null and address_reveal_at is not null
                 and address_reveal_at <= now() and slug <> 'underground' and id <> '63b511f3-d838-404f-9c2e-5d4b98fbf013') then return; end if;
  perform net.http_post(url := url, headers := jsonb_build_object('x-runner-secret', secret, 'Content-Type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 120000);
end $$;
revoke all on function public.run_reveal() from public, anon, authenticated;
select cron.unschedule('address-reveal') where exists (select 1 from cron.job where jobname = 'address-reveal');
select cron.schedule('address-reveal', '*/15 * * * *', 'select public.run_reveal()');
