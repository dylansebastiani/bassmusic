-- Artist profiles: what an artist tells fans about themselves, filled in from their artist pass page.
-- Photo, bio, hometown, genre and links show on the show page lineup right away (staff can hide them).
-- rider is private: only the promoter sees it, on the staff dashboard.
alter table public.artist_invites
  add column if not exists photo_path text,
  add column if not exists bio text,
  add column if not exists hometown text,
  add column if not exists genre text,
  add column if not exists links jsonb not null default '{}'::jsonb,
  add column if not exists rider text,
  add column if not exists profile_hidden boolean not null default false;
-- Artist photos are public (they're shown on public show pages). Uploads only happen through one-time
-- signed links handed out by the artist function, so nobody can write here directly.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artist-photos', 'artist-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
