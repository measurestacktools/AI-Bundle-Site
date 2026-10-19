// Single-use download tokens. Stored as SHA-256 hashes; the raw token only
// ever travels to the customer's browser after the PAID + ownership check.
import { nowIso } from "./db.js";
import { sha256Hex, randomHex } from "./crypto.js";

export const TOKEN_TTL_MS = 10 * 60 * 1000;

const isoIn = (ms) => new Date(Date.now() + ms).toISOString();
const expired = (iso) => Date.parse(iso) < Date.now();

export async function createDownloadToken(db, orderId) {
  const token = randomHex(32);
  await db
    .prepare(`INSERT INTO download_tokens (token_hash, order_id, expires_at, used, created_at)
              VALUES (?, ?, ?, 0, ?)`)
    .bind(await sha256Hex(token), orderId, isoIn(TOKEN_TTL_MS), nowIso())
    .run();
  return token;
}

// Single-use redeem: returns order_id on success, else null. Marks used
// BEFORE the caller streams bytes, so a token can never download twice.
export async function redeemDownloadToken(db, token) {
  if (typeof token !== "string" || !token) return null;
  const h = await sha256Hex(token);
  const row = await db
    .prepare(`SELECT order_id, expires_at, used FROM download_tokens WHERE token_hash = ?`)
    .bind(h).first();
  if (!row || row.used || expired(row.expires_at)) return null;
  const upd = await db
    .prepare(`UPDATE download_tokens SET used = 1 WHERE token_hash = ? AND used = 0`)
    .bind(h).run();
  if ((upd?.meta?.changes ?? 0) !== 1) return null;
  return row.order_id;
}
