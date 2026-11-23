-- Safety lock while promoter checkout isn't live yet.
-- A promoter's show (a company that isn't on the original Stripe account) can't be put on sale until
-- settings.connect_checkout_live is true. That flag is turned on only when the promoter checkout
-- (tickets + stripe-webhook with Stripe Connect) is deployed, so promoter money can never reach the
-- original account by mistake. Shows on the original account (T.O.F.T.U.) are not affected.
create or replace function public.connect_sales_lock() returns trigger language plpgsql as $$
begin
  if new.sales_open and not coalesce(old.sales_open, false) and new.company_id is not null
     and exists (select 1 from public.companies c where c.id = new.company_id and not c.legacy_stripe)
     and coalesce((select (value)::text from public.settings where key = 'connect_checkout_live'), 'false') <> 'true' then
    raise exception 'Promoter shows can''t go on sale until promoter checkout is live.';
  end if;
  return new;
end $$;
drop trigger if exists connect_sales_lock on public.events;
create trigger connect_sales_lock before insert or update of sales_open on public.events
  for each row execute function public.connect_sales_lock();
