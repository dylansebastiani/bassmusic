-- Schedule the email runner every 10 minutes. pg_cron calls the Edge Function
-- over HTTP with the shared secret.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.run_email_runner() returns void
language plpgsql as $$
declare
  url text := (select value #>> '{}' from public.settings where key = 'functions_url') || '/email-runner';
  secret text := (select value #>> '{}' from public.settings where key = 'runner_secret');
begin
  if url is null or secret is null then return; end if;
  perform net.http_post(url := url, headers := jsonb_build_object('x-runner-secret', secret, 'Content-Type', 'application/json'), body := '{}'::jsonb);
end $$;
select cron.schedule('email-runner', '*/10 * * * *', 'select public.run_email_runner()');
-- Daily tidy of rate-limit windows (the one delete, kept out of the request path).
select cron.schedule('prune-rate-limits', '7 4 * * *', $$delete from public.rate_limits where window_start < now() - interval '1 day'$$);
