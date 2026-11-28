-- "Message my crowd": one row per email a promoter sends to their own past buyers.
-- For Dylan's review. Not applied.
-- The unique (company_id, day) key is the server-side rate limit: one send per company per UTC day.
-- The row is claimed before any mail goes out, so two taps cannot both send.
-- No email addresses are stored here, only counts.

create table if not exists public.crowd_sends (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  event_id uuid not null references public.events(id) on delete cascade,
  sent_by uuid references public.subscribers(id),
  subject text not null,
  next_date text,
  day date not null default ((now() at time zone 'utc')::date),
  recipients int not null default 0,
  sent int not null default 0,
  status text not null default 'sending' check (status in ('sending','sent','stopped')),
  created_at timestamptz not null default now(),
  check (char_length(subject) between 1 and 140),
  check (event_id <> '63b511f3-d838-404f-9c2e-5d4b98fbf013'::uuid),
  unique (company_id, day)
);
create index if not exists crowd_sends_company on public.crowd_sends (company_id, created_at desc);
alter table public.crowd_sends enable row level security;
-- No policies on purpose. Only the service role (inside functions) reads or writes.
