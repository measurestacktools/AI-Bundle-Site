-- STEP 3 order store (Cloudflare D1). Apply: wrangler d1 execute ai-bundle-orders --file migrations/0001_init.sql
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  cashfree_order_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  product_id TEXT NOT NULL DEFAULT 'ai-projects-bundle',
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'CREATED',
  created_at TEXT NOT NULL,
  paid_at TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  last_download_at TEXT,
  fulfillment_status TEXT NOT NULL DEFAULT 'NONE',
  email_status TEXT NOT NULL DEFAULT 'PENDING',
  cf_payment_id TEXT,
  payment_reference TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_cf ON orders(cashfree_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT UNIQUE NOT NULL,
  cashfree_order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_cf ON payment_events(cashfree_order_id);
