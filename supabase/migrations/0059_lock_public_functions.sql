-- Security advisor clean-up (Nov 28 2026 audit).
-- 1. The browser's public key could call four helper functions through the API. They run with the caller's rights,
--    so RLS already hid every row, but nothing outside the functions should call them. Only the service role
--    (inside Edge Functions) and the owner keep EXECUTE. capped_quote is still called by account and tickets as service_role.
revoke execute on function public.capped_quote(uuid, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.night_fill(uuid) from public, anon, authenticated;
revoke execute on function public.night_day_type(uuid) from public, anon, authenticated;
revoke execute on function public.tier_at(jsonb, integer) from public, anon, authenticated;
grant execute on function public.capped_quote(uuid, jsonb, integer) to service_role;
grant execute on function public.night_fill(uuid) to service_role;
grant execute on function public.night_day_type(uuid) to service_role;
grant execute on function public.tier_at(jsonb, integer) to service_role;
-- 2. Pin search_path on the three functions that had none (the other helpers already use public, extensions).
alter function public.tier_at(jsonb, integer) set search_path = public, extensions;
alter function public.connect_sales_lock() set search_path = public, extensions;
alter function public.crm_resync_subscriber() set search_path = public, extensions;
