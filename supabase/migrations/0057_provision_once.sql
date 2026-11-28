-- Additive only. One call that makes a promoter's company and owner row together, and only if they have no crew yet.
-- A per-person advisory lock makes two simultaneous sign-ins queue up, so the second one sees the first one's crew
-- and makes nothing. No table or column changes. Only the service role (inside functions) can run it.
create or replace function public.provision_promoter_company(p_subscriber uuid, p_email text, p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_slug text := p_slug;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('provision:' || p_subscriber::text, 0));
  if exists (select 1 from public.company_staff where subscriber_id = p_subscriber) then
    return null;
  end if;
  if exists (select 1 from public.companies where slug = v_slug) then
    v_slug := left(v_slug, 55) || '-' || substr(md5(random()::text), 1, 4);
  end if;
  insert into public.companies (slug, name, status, contact_email)
  values (v_slug, p_name, 'active', p_email) returning id into v_id;
  insert into public.company_staff (company_id, subscriber_id, role) values (v_id, p_subscriber, 'owner');
  return v_id;
end $$;
revoke all on function public.provision_promoter_company(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.provision_promoter_company(uuid, text, text, text) to service_role;
