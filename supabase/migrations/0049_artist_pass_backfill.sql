-- Artist Pass for the five shows that were created without one.
-- Same columns as migration 0020: slug artist, name Artist Pass, blurb Artists only,
-- every night of that show (ordered by sort), tiers [], not on sale, sort 99.
-- This inserts those rows and nothing else. It does not send email.
-- A show that already has an artist pass is skipped.
-- T.O.F.T.U. is excluded by event id and by slug. The block stops if that id
-- is not the underground show, or if the underground show's ticket types,
-- ticket nights, or sales flag differ after the insert.

do $$
declare
  underground uuid := '63b511f3-d838-404f-9c2e-5d4b98fbf013';
  before_types text;
  after_types text;
  before_nights text;
  after_nights text;
  before_events text;
  after_events text;
  before_kept text;
  after_kept text;
  before_artist int;
  after_artist int;
  inserted int;
begin
  if exists (select 1 from public.events where id = underground and slug is distinct from 'underground') then
    raise exception 'refusing: event % is not slug underground', underground;
  end if;
  if exists (select 1 from public.events where slug = 'underground' and id is distinct from underground) then
    raise exception 'refusing: slug underground is not event %', underground;
  end if;

  select md5(coalesce(string_agg(
    concat_ws('|', t.id::text, t.event_id::text, t.slug, t.name, coalesce(t.blurb, ''), coalesce(t.blurb_full, ''),
      t.night_ids::text, t.tiers::text, coalesce(t.door_price_cents::text, ''), t.on_sale::text, t.sort::text,
      coalesce(t.linked_discount_cents::text, ''), coalesce(t.max_qty::text, '')),
    ',' order by t.id), ''))
  into before_types
  from public.ticket_types t
  where t.event_id = underground;

  select count(*) into before_artist
  from public.ticket_types t
  where t.event_id = underground and t.slug = 'artist';

  select md5(coalesce(string_agg(
    concat_ws('|', n.id::text, n.event_id::text, n.slug, n.label, coalesce(n.starts_at::text, ''), coalesce(n.ends_at::text, ''), n.sort::text),
    ',' order by n.id), ''))
  into before_nights
  from public.ticket_nights n
  where n.event_id = underground;

  select md5(coalesce(string_agg(
    concat_ws('|', e.id::text, e.slug, e.sales_open::text, coalesce(e.company_id::text, '')),
    ',' order by e.id), ''))
  into before_events
  from public.events e
  where e.id = underground
     or e.id in (
       '9743b63f-088a-427a-ae15-458b1a141e2d',
       '8c9d2b30-0b91-4d4a-91e3-9bb8dd3e127d',
       '1cbc1482-f426-42a2-9c50-9457f52cef89',
       'd5c4072b-cf8b-406d-84ba-732c1372b950',
       'a3b8d360-c347-415a-9184-c098beefa9a8'
     );

  select md5(coalesce(string_agg(
    concat_ws('|', t.id::text, t.event_id::text, t.slug, t.name, coalesce(t.blurb, ''),
      t.night_ids::text, t.tiers::text, t.on_sale::text, t.sort::text),
    ',' order by t.id), ''))
  into before_kept
  from public.ticket_types t
  where t.event_id in (
      '9743b63f-088a-427a-ae15-458b1a141e2d',
      '8c9d2b30-0b91-4d4a-91e3-9bb8dd3e127d',
      '1cbc1482-f426-42a2-9c50-9457f52cef89',
      'd5c4072b-cf8b-406d-84ba-732c1372b950',
      'a3b8d360-c347-415a-9184-c098beefa9a8'
    )
    and t.slug <> 'artist';

  insert into public.ticket_types (event_id, slug, name, blurb, night_ids, tiers, on_sale, sort)
  select e.id, 'artist', 'Artist Pass', 'Artists only',
         array(select n.id from public.ticket_nights n where n.event_id = e.id order by n.sort),
         '[]'::jsonb, false, 99
  from public.events e
  where e.id in (
      '9743b63f-088a-427a-ae15-458b1a141e2d',  -- test-night
      '8c9d2b30-0b91-4d4a-91e3-9bb8dd3e127d',  -- test-fest
      '1cbc1482-f426-42a2-9c50-9457f52cef89',  -- zz-lane-test
      'd5c4072b-cf8b-406d-84ba-732c1372b950',  -- testing
      'a3b8d360-c347-415a-9184-c098beefa9a8'   -- test-grok-show
    )
    and e.slug in ('test-night', 'test-fest', 'zz-lane-test', 'testing', 'test-grok-show')
    and e.slug <> 'underground'
    and e.id <> underground
    and not exists (
      select 1 from public.ticket_types t
      where t.event_id = e.id and t.slug = 'artist'
    );

  get diagnostics inserted = row_count;
  if inserted > 5 then
    raise exception 'refusing: inserted % artist passes', inserted;
  end if;

  select md5(coalesce(string_agg(
    concat_ws('|', t.id::text, t.event_id::text, t.slug, t.name, coalesce(t.blurb, ''), coalesce(t.blurb_full, ''),
      t.night_ids::text, t.tiers::text, coalesce(t.door_price_cents::text, ''), t.on_sale::text, t.sort::text,
      coalesce(t.linked_discount_cents::text, ''), coalesce(t.max_qty::text, '')),
    ',' order by t.id), ''))
  into after_types
  from public.ticket_types t
  where t.event_id = underground;

  select count(*) into after_artist
  from public.ticket_types t
  where t.event_id = underground and t.slug = 'artist';

  select md5(coalesce(string_agg(
    concat_ws('|', n.id::text, n.event_id::text, n.slug, n.label, coalesce(n.starts_at::text, ''), coalesce(n.ends_at::text, ''), n.sort::text),
    ',' order by n.id), ''))
  into after_nights
  from public.ticket_nights n
  where n.event_id = underground;

  select md5(coalesce(string_agg(
    concat_ws('|', e.id::text, e.slug, e.sales_open::text, coalesce(e.company_id::text, '')),
    ',' order by e.id), ''))
  into after_events
  from public.events e
  where e.id = underground
     or e.id in (
       '9743b63f-088a-427a-ae15-458b1a141e2d',
       '8c9d2b30-0b91-4d4a-91e3-9bb8dd3e127d',
       '1cbc1482-f426-42a2-9c50-9457f52cef89',
       'd5c4072b-cf8b-406d-84ba-732c1372b950',
       'a3b8d360-c347-415a-9184-c098beefa9a8'
     );

  select md5(coalesce(string_agg(
    concat_ws('|', t.id::text, t.event_id::text, t.slug, t.name, coalesce(t.blurb, ''),
      t.night_ids::text, t.tiers::text, t.on_sale::text, t.sort::text),
    ',' order by t.id), ''))
  into after_kept
  from public.ticket_types t
  where t.event_id in (
      '9743b63f-088a-427a-ae15-458b1a141e2d',
      '8c9d2b30-0b91-4d4a-91e3-9bb8dd3e127d',
      '1cbc1482-f426-42a2-9c50-9457f52cef89',
      'd5c4072b-cf8b-406d-84ba-732c1372b950',
      'a3b8d360-c347-415a-9184-c098beefa9a8'
    )
    and t.slug <> 'artist';

  if before_types is distinct from after_types
     or before_artist is distinct from after_artist
     or before_nights is distinct from after_nights
     or before_events is distinct from after_events
     or before_kept is distinct from after_kept then
    raise exception 'refusing: a watched row changed';
  end if;
end $$;
