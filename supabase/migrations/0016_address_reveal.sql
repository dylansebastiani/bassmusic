-- Secret location: the public address stays empty until address_reveal_at.
-- At reveal, a job copies address_full/venue_full into the public columns and asks the
-- tickets function to email every ticket holder. Each order is marked as it sends
-- (ticket_orders.location_sent_at), so a timed-out or rate-limited run just resumes.
alter table events add column if not exists location_secret boolean not null default false;
alter table events add column if not exists address_reveal_at timestamptz;
alter table events add column if not exists address_full text;
alter table events add column if not exists venue_full text;
alter table ticket_orders add column if not exists location_sent_at timestamptz;

create or replace function public.reveal_due_locations() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e record; k text; fn text;
begin
  select value#>>'{}' into k from settings where key = 'reveal_key';
  if k is null then return; end if;
  fn := coalesce((select value#>>'{}' from settings where key = 'functions_url'), 'https://hxfuelulxsituzcgsvhg.supabase.co/functions/v1');
  for e in select id, slug from events
           where location_secret and address_reveal_at is not null and address_reveal_at <= now() and address_full is not null loop
    update events set address = address_full, venue = coalesce(venue_full, venue) where id = e.id and address is null;
    if exists (select 1 from ticket_orders where event_id = e.id and status in ('paid','comp') and email is not null and location_sent_at is null) then
      perform net.http_post(
        url := fn || '/tickets?a=reveal&e=' || e.slug,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-reveal-key', k),
        body := '{}'::jsonb, timeout_milliseconds := 300000);
    end if;
  end loop;
end $$;
revoke all on function public.reveal_due_locations() from public, anon, authenticated;

-- Every 15 minutes, Jan 1-3 (UTC). Before the reveal time it does nothing.
select cron.unschedule('location-reveal') where exists (select 1 from cron.job where jobname = 'location-reveal');
select cron.schedule('location-reveal', '*/15 * 1-3 1 *', 'select public.reveal_due_locations()');
