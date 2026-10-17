-- Schedule the email runner every 10 minutes. pg_cron calls the Edge Function
-- over HTTP with the shared secret. Run this AFTER setting RUNNER_SECRET as an
-- Edge Function secret and storing the same value in settings.runner_secret.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.run_email_runner() returns void
language plpgsql security definer set search_path = public as $$
declare
  url text := (select value #>> '{}' from settings where key = 'functions_url') || '/email-runner';
  secret text := (select value #>> '{}' from settings where key = 'runner_secret');
begin
  if url is null or secret is null then return; end if;
  perform net.http_post(url := url, headers := jsonb_build_object('x-runner-secret', secret, 'Content-Type', 'application/json'), body := '{}'::jsonb);
end $$;
revoke all on function public.run_email_runner() from public, anon, authenticated;

select cron.unschedule('email-runner') where exists (select 1 from cron.job where jobname = 'email-runner');
select cron.schedule('email-runner', '*/10 * * * *', $$select public.run_email_runner()$$);
