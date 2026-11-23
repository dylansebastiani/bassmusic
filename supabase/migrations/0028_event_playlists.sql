-- Each show can carry its own playlist for the music bar on its page.
-- events.playlist = { mode: "subduction" | "upload", tracks: [{ path, title, artist }] }. Null means Subduction tracks.
alter table public.events add column if not exists playlist jsonb;
-- Promoter-uploaded audio lives in its own private bucket; the page only ever gets 1-hour stream links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('playlists', 'playlists', false, 41943040, array['audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/x-m4a','audio/aac'])
on conflict (id) do nothing;
