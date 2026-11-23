-- Show pages described as data (see supabase/functions/_shared/page_spec.ts and docs/PAGE_SPEC.md).
-- page_draft is what Dylan and Claude work on in the studio; page is what the public sees.
-- Publishing copies the draft over. Both are cleaned on the way out, so nothing unsafe is ever rendered.
-- Additive only: shows without a page keep using the existing tickets page.
alter table public.events add column if not exists page_draft jsonb;
alter table public.events add column if not exists page jsonb;
alter table public.events add column if not exists page_published_at timestamptz;
alter table public.events add column if not exists page_published_by citext;
