-- Everyone who buys a ticket or gets guest-listed becomes a member.
-- Runs in the database the moment an order turns paid or comp, so the payment and guest-list
-- code don't change. It never blocks a ticket: any error here is logged and skipped.
--   * New email: a member is created with their first name and phone. sms_consent stays false
--     (texting needs its own opt-in). The welcome email (with the free track) is queued for
--     about a day later, so it doesn't land on top of the ticket email.
--   * Existing member: only blanks are filled in (first name, phone). Someone who unsubscribed
--     stays unsubscribed.
create or replace function public.ticket_order_member() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare s_id uuid; existing_id uuid; first text; code text; i int := 0;
begin
  if new.status not in ('paid', 'comp') or new.email is null then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  begin
    first := nullif(split_part(btrim(coalesce(new.name, '')), ' ', 1), '');
    select id into existing_id from subscribers where email = lower(new.email);
    if existing_id is null then
      loop
        code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
        exit when not exists (select 1 from subscribers where referral_code = code) or i > 5;
        i := i + 1;
      end loop;
      insert into subscribers (email, first_name, phone, source, event_id, referral_code, sms_consent)
      values (lower(new.email), first, new.phone, case when new.status = 'comp' then 'guestlist' else 'tickets' end, new.event_id, code, false)
      on conflict (email) do nothing
      returning id into s_id;
      if s_id is not null then
        insert into email_queue (subscriber_id, template_key, priority, send_after)
        values (s_id, 'welcome', 2, now() + interval '1 day');
      end if;
    else
      update subscribers set first_name = coalesce(first_name, first), phone = coalesce(phone, new.phone)
      where id = existing_id and status <> 'deleted';
    end if;
  exception when others then
    raise warning 'ticket_order_member: % (order %)', sqlerrm, new.id;
  end;
  return new;
end $$;
revoke all on function public.ticket_order_member() from public, anon, authenticated;

drop trigger if exists ticket_order_member on ticket_orders;
create trigger ticket_order_member after insert or update of status on ticket_orders
for each row execute function public.ticket_order_member();

-- Catch up: people who already have a ticket or guest list spot.
do $$
declare o record; s_id uuid; code text; i int;
begin
  for o in select distinct on (lower(email)) email, name, phone, status, event_id from ticket_orders
           where status in ('paid', 'comp') and email is not null order by lower(email), created_at loop
    if not exists (select 1 from subscribers where email = lower(o.email)) then
      i := 0;
      loop
        code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
        exit when not exists (select 1 from subscribers where referral_code = code) or i > 5;
        i := i + 1;
      end loop;
      insert into subscribers (email, first_name, phone, source, event_id, referral_code, sms_consent)
      values (lower(o.email), nullif(split_part(btrim(coalesce(o.name, '')), ' ', 1), ''), o.phone,
              case when o.status = 'comp' then 'guestlist' else 'tickets' end, o.event_id, code, false)
      returning id into s_id;
      insert into email_queue (subscriber_id, template_key, priority, send_after) values (s_id, 'welcome', 2, now() + interval '1 day');
    else
      update subscribers set first_name = coalesce(first_name, nullif(split_part(btrim(coalesce(o.name, '')), ' ', 1), '')), phone = coalesce(phone, o.phone)
      where email = lower(o.email) and status <> 'deleted';
    end if;
  end loop;
end $$;
