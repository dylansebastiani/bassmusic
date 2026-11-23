-- Cover art for tracks artists add to a show's playlist (optional). Lives next to the audio in the
-- private playlists bucket; the page only ever gets 1-hour links.
alter table public.playlist_tracks add column if not exists art_path text;
update storage.buckets
  set allowed_mime_types = array['audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/x-m4a','audio/aac','image/jpeg','image/png','image/webp']
  where id = 'playlists';
