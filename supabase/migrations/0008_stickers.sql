-- How many stickers went out for a show, so the Numbers tab can show a scan rate.
alter table public.events add column if not exists stickers integer not null default 0;
