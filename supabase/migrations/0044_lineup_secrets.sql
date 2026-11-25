-- Lineup secrets: a show can publish its lineup while keeping set times hidden, and any act in the
-- draft (lineup_full) can carry "secret": true so it never reaches the public lineup.
alter table events add column if not exists hide_set_times boolean not null default false;
