-- The artist waitlist page also asks for the artist's full name and phone number.
alter table public.artist_waitlist add column if not exists full_name text, add column if not exists phone text;
