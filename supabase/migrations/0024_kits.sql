-- Brand kit (once per promoter) and event kit (per show). Promoters, or Dylan on their behalf, upload files;
-- the draft builder merges brand + event kit into a first page draft for the studio (event wins).
-- Formats and checks: supabase/functions/_shared/kits.ts. Additive only.
alter table public.companies add column if not exists brand jsonb not null default '{}';
alter table public.events add column if not exists kit jsonb not null default '{}';

-- Kit files: public (they're meant to be seen on show pages), written only through one-time signed
-- upload links the promoter function hands to signed-in company staff. Images and short MP4 teasers.
-- No SVG: an SVG opened directly could run script on the storage domain.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kits', 'kits', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
