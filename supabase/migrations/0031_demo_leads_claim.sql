-- The demo's last step opens a promoter account: which crew it made, and the one-tap key from the email (stored hashed).
alter table public.demo_leads add column if not exists claim_hash text, add column if not exists company_id uuid references public.companies(id) on delete set null, add column if not exists claimed_at timestamptz;
