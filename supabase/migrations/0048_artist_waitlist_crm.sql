-- Artist waitlist rows remember when their Brevo contact was saved, and when Dylan was told.
-- subscribers.crm_role remembers the label we last sent, so a promoter stored as Member can be corrected once.
-- Nothing is deleted. Existing rows stay. Both new columns are nullable.

alter table public.artist_waitlist add column if not exists crm_synced_at timestamptz;
alter table public.artist_waitlist add column if not exists alerted_at timestamptz;
alter table public.subscribers add column if not exists crm_role text;
