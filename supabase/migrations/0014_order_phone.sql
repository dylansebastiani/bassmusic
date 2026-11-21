-- Buyer's phone number, collected at checkout for order contact (not marketing; SMS consent is separate).
alter table ticket_orders add column if not exists phone text;
