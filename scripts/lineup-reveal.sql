-- Phase-in: put the full T.O.F.T.U. lineup back on the tickets page (flyers reappear automatically).
update ticket_nights set lineup = lineup_full where lineup_full is not null;
update ticket_types  set blurb  = blurb_full  where blurb_full  is not null;
-- Also swap the og/twitter description in site/tickets.html back to the lineup version
-- (see branch release/full-lineup) and push.
