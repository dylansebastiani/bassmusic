-- Lossless download for a drop (e.g. the WAV), private like the stream. Served only
-- through a short-lived signed link from the `me` function, and only once the member
-- has unlocked it (first name, phone and ZIP on file).
alter table public.drops add column if not exists download_path text;
update public.drops set download_path = 'elite-depth/elite-depth.wav' where slug = 'elite-depth';
