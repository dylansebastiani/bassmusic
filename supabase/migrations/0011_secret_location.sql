-- A show can keep its venue off the public page. Ticket holders still see it on their
-- ticket and in their ticket email.
alter table public.events add column if not exists location_secret boolean not null default false;
