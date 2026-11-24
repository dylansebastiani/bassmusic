-- Artist ticket-selling: each artist on a show gets a personal link tag (?ref=) and a personal $0 promo code.
-- Both checkouts already save ref + promo on every order, so sales are credited by reading data, not by
-- changing either checkout. Filled in lazily by the artist-sales function.
alter table public.artist_invites
  add column if not exists sell_ref text,
  add column if not exists sell_promo_id uuid references public.promo_codes(id) on delete set null;
create unique index if not exists artist_invites_sell_ref_uq on public.artist_invites (event_id, lower(sell_ref)) where sell_ref is not null;
create index if not exists ticket_orders_event_ref_idx on public.ticket_orders (event_id, lower(ref)) where ref is not null;
