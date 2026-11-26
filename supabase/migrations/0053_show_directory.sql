-- External shows submitted from the public directory at /shows.
-- A row stays off the public list until Dylan approves it.
-- Subduction-ticketed shows are not copied here. The directory function reads those from events.
-- RLS on, no policies. Only the service role inside the directory function reads or writes.
-- Nothing in this file changes events, tickets, checkout, or the underground show.

create table if not exists public.directory_listings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  show_date date not null,
  venue text not null,
  city text not null,
  state text not null,
  ticket_url text not null,
  flyer_path text,
  submitter_email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_token_hash text,
  ip_hash text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists directory_listings_public_idx
  on public.directory_listings (show_date)
  where status = 'approved';

create index if not exists directory_listings_pending_idx
  on public.directory_listings (created_at)
  where status = 'pending';

-- One open submission per ticket link, so a double click cannot file the same show twice.
create unique index if not exists directory_listings_ticket_url_open_idx
  on public.directory_listings (lower(ticket_url))
  where status in ('pending', 'approved');

alter table public.directory_listings enable row level security;
revoke all on table public.directory_listings from anon, authenticated, public;

-- Flyers are meant to be seen. Writes happen only from the directory function (service role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('directory', 'directory', true, 1572864, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
