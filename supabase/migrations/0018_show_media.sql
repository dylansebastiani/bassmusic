-- Staff page: per-night flyers and a swappable share image, uploaded from a phone.
-- Images live in a public `media` bucket (they're meant to be seen); uploads only happen
-- through signed URLs the admin function hands out, so nobody else can write there.
alter table ticket_nights add column if not exists flyer_url text;
alter table events add column if not exists share_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
