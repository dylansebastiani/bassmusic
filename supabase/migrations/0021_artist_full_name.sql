-- An artist's real name, kept for the door list and their member record.
-- Their ticket, PDF and email show their artist name (artist_invites.name) instead.
alter table public.artist_invites add column if not exists full_name text;
