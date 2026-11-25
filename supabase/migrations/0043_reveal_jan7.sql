-- Optional per-show note in the location-drop email (T.O.F.T.U.: a birthday shout-out for Badguy Moolah).
alter table public.events add column if not exists reveal_note text;
-- T.O.F.T.U. location now drops Thu Jan 7 at 12 PM Chicago (18:00 UTC) instead of Fri Jan 1.
update public.events set address_reveal_at = '2027-01-07 18:00:00+00',
  reveal_note = 'P.S. It''s Badguy Moolah''s birthday! Come through this weekend and celebrate with him.'
  where slug = 'underground';
-- The reveal job only needs to run around the drop: every 15 minutes, Jan 6-8 (UTC).
select cron.unschedule('location-reveal') where exists (select 1 from cron.job where jobname = 'location-reveal');
select cron.schedule('location-reveal', '*/15 * 6-8 1 *', 'select public.reveal_due_locations()');
