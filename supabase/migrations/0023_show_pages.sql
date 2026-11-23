-- Show pages described as data (see supabase/functions/_shared/page_spec.ts and docs/PAGE_SPEC.md).
-- page_draft is what Dylan and Claude work on in the studio; page is what the public sees.
-- Publishing copies the draft over. Both are cleaned on the way out, so nothing unsafe is ever rendered.
-- Additive only: shows without a page keep using the existing tickets page.
alter table public.events add column if not exists page_draft jsonb;
alter table public.events add column if not exists page jsonb;
alter table public.events add column if not exists page_published_at timestamptz;
alter table public.events add column if not exists page_published_by citext;
-- When the draft last changed (by the studio or by Claude), so an open studio can pick up edits live.
alter table public.events add column if not exists page_draft_at timestamptz;
create or replace function public.page_draft_touch() returns trigger language plpgsql set search_path = public as $$
begin
  if new.page_draft is distinct from old.page_draft then new.page_draft_at := now(); end if;
  return new;
end $$;
revoke all on function public.page_draft_touch() from public, anon, authenticated;
drop trigger if exists page_draft_touch on events;
create trigger page_draft_touch before update of page_draft on events for each row execute function public.page_draft_touch();
