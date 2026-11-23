-- Artist free downloads now go through the same member flow as every other track (email, then
-- first name / phone / ZIP once). Each download points at the member, so the fan list always
-- shows their current details, and a member who deletes their account drops off it.
alter table public.track_downloads alter column name drop not null;
alter table public.track_downloads add column if not exists subscriber_id uuid references public.subscribers(id) on delete cascade;
create index if not exists track_downloads_member on public.track_downloads(track_id, subscriber_id);
