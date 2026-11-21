-- Rule: RLS on, no policies, service role only. The unused starter `waitlist` table
-- still had an anon insert policy from 0001; remove it.
drop policy if exists "anyone can join" on public.waitlist;
