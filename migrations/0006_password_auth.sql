-- 0006: email + password sign-in for customer accounts.
-- Additive only. Apply once per database (skip if the columns already exist;
-- SQLite has no "ADD COLUMN IF NOT EXISTS"):
--   wrangler d1 execute ai-bundle-orders --remote --file migrations/0006_password_auth.sql
--
-- Google accounts keep google_sub as their identity. Password accounts store a
-- PBKDF2-SHA256 hash (100k iterations) plus a 16-byte random salt; the plain
-- password is never stored. password_iters lets the cost be raised later.
ALTER TABLE accounts ADD COLUMN password_hash TEXT;
ALTER TABLE accounts ADD COLUMN password_salt TEXT;
ALTER TABLE accounts ADD COLUMN password_iters INTEGER;
