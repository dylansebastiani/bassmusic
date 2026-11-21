-- Phased release: the full lineup and artist blurbs are parked here while the public page runs without them.
alter table ticket_nights add column if not exists lineup_full jsonb;
alter table ticket_types add column if not exists blurb_full text;
