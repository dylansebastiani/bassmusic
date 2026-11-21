-- Security pass. The browser's public (anon) key gets nothing: no table access, no functions.
-- Everything goes through the Edge Functions with the service role, as CLAUDE.md requires.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- These two were callable by anyone with the public key: someone could fill the rate-limit
-- table (locking real buyers out) or fire the email runner. Server-side only now.
revoke execute on function public.bump_rate_limit(text) from public, anon, authenticated;
revoke execute on function public.run_email_runner() from public, anon, authenticated;
grant execute on function public.bump_rate_limit(text) to service_role;
grant execute on function public.run_email_runner() to service_role;
alter function public.bump_rate_limit(text) set search_path = public, extensions;
alter function public.run_email_runner() set search_path = public, extensions;

-- Who started each checkout (hashed connection, never the raw IP), so one person can't
-- hold the whole room hostage by opening checkouts over and over.
alter table public.ticket_orders add column if not exists ip_hash text;
create index if not exists ticket_orders_ip_pending on public.ticket_orders (ip_hash, status, hold_until);
