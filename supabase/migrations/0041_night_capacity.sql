-- How many people a night can hold. Only sold tickets fill it: a 2-day pass takes one spot
-- on each of its nights; artists and the guest list don't count. Null = not set yet.
-- Display only for now: the checkout does not read this column.
alter table public.ticket_nights add column if not exists capacity int;
update public.ticket_nights n set capacity = 150
  from public.events e where e.id = n.event_id and e.slug = 'underground' and n.capacity is null;
