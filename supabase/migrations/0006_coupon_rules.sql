-- A coupon can be earned by being at a show (scanned there) or by holding an artist's
-- track. Both optional; min_tracks stays. All rules on a coupon must be met.
alter table public.coupons
  add column if not exists event_id uuid references public.events(id),
  add column if not exists artist_slug text;
