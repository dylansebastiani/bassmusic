-- A second, lighter key per member. A QR scan with a known email hands this one out: it
-- plays tracks and shows events, and can never read or change name, phone or ZIP. Only
-- the emailed code or the emailed link hands out the full key (access_token).
alter table public.subscribers add column if not exists light_token uuid not null default gen_random_uuid();
create unique index if not exists subscribers_light_token_idx on public.subscribers (light_token);
