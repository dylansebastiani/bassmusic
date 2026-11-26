-- Emails typed on the promoter page by people who are not already on a crew.
-- Its own table, touched by the promoter function and crm-sync. RLS on with no policies:
-- only the service role (inside functions) reads or writes.
create table if not exists public.promoter_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text not null default 'direct',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  ip_hash text,
  crm_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists promoter_leads_unsynced_idx on public.promoter_leads (created_at) where crm_synced_at is null;
alter table public.promoter_leads enable row level security;

-- Where a page view came from. Nullable so rows already stored stay as they are.
alter table public.page_views
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists referrer text;
