-- 0004: link orders to the signed-in account that bought them.
-- Additive only. Apply once per database:
--   wrangler d1 execute ai-bundle-orders --remote --file migrations/0004_order_account.sql
ALTER TABLE orders ADD COLUMN account_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id);
