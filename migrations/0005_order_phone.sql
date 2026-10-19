-- 0005: store the customer's mobile number on the order.
-- Additive only. Apply once per database:
--   wrangler d1 execute ai-bundle-orders --remote --file migrations/0005_order_phone.sql
ALTER TABLE orders ADD COLUMN phone TEXT;
