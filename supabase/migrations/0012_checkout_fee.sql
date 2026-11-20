-- Card fee passed to the buyer at checkout. total_cents = what the buyer paid (tickets - discount + fee).
alter table public.ticket_orders add column if not exists fee_cents int not null default 0;
