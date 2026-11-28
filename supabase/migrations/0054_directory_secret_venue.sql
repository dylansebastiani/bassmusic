-- Outside listings can mark the venue as a secret location.
-- When true, the public list, city pages and calendar files say "Secret location".
-- The typed venue stays here for Dylan's review page only.
alter table public.directory_listings add column if not exists venue_secret boolean not null default false;
