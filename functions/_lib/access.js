// Purchase-access storage: email OTP codes, short-lived grants, single-use
// download tokens. All secrets are stored as SHA-256 hashes; raw codes and
// tokens only ever travel to the customer's own email / browser session.
import { nowIso } from "./db.js";
import { sha256Hex, randomHex, safeEqual } from "./crypto.js";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_COOLDOWN_MS = 60 * 1000;
export const GRANT_TTL_MS = 15 * 60 * 1000;
export const TOKEN_TTL_MS = 10 * 60 * 1000;

export function newAccessCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900000;
  return String(100000 + n);
}

const isoIn = (ms) => new Date(Date.now() + ms).toISOString();
const expired = (iso) => Date.parse(iso) < Date.now();

export async function pruneAccessRows(db, email) {
  const now = nowIso();
  await db.prepare(`DELETE FROM access_codes WHERE email = ? AND (used = 1 OR expires_at < ?)`)
    .bind(email, now).run();
  await db.prepare(`DELETE FROM access_grants WHERE email = ? AND expires_at < ?`)
    .bind(email, now).run();
}

export async function lastCodeAt(db, email) {
  const row = await db
    .prepare(`SELECT created_at FROM access_codes WHERE email = ? ORDER BY id DESC LIMIT 1`)
    .bind(email).first();
  return row ? Date.parse(row.created_at) : 0;
}

export async function createAccessCode(db, email) {
  const code = newAccessCode();
  await db
    .prepare(
      `INSERT INTO access_codes (email, code_hash, expires_at, attempts, used, created_at)
       VALUES (?, ?, ?, 0, 0, ?)`
    )
    .bind(email, await sha256Hex(code), isoIn(CODE_TTL_MS), nowIso())
    .run();
  return code;
}

export async function findPaidOrdersByEmail(db, email, productId) {
  const res = await db
    .prepare(
      `SELECT id, product_id, status, paid_at FROM orders
       WHERE email = ? AND status = 'PAID' AND product_id = ? ORDER BY paid_at DESC LIMIT 20`
    )
    .bind(email, productId).all();
  return res?.results || [];
}

// Returns the matched (unused, unexpired) code row or null. Does not consume.
export async function findLiveCode(db, email, code) {
  const want = await sha256Hex(String(code || ""));
  const res = await db
    .prepare(
      `SELECT id, code_hash, expires_at, attempts, used FROM access_codes
       WHERE email = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 5`
    )
    .bind(email, nowIso()).all();
  const rows = res?.results || [];
  // Constant-time compare per candidate; hashes deserve the same care
  // as webhook signatures.
  for (const row of rows) {
    if (safeEqual(row.code_hash, want)) return row;
  }
  return null;
}

export async function consumeCode(db, id) {
  await db.prepare(`UPDATE access_codes SET used = 1 WHERE id = ?`).bind(id).run();
}

export async function bumpCodeAttempts(db, email) {
  await db
    .prepare(
      `UPDATE access_codes SET attempts = attempts + 1
       WHERE id = (SELECT id FROM access_codes WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1)`
    )
    .bind(email).run();
}

export async function codeLockedOut(db, email) {
  const row = await db
    .prepare(`SELECT attempts FROM access_codes WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1`)
    .bind(email).first();
  return row ? row.attempts >= CODE_MAX_ATTEMPTS : false;
}

export async function createGrant(db, email) {
  const token = randomHex(32);
  await db
    .prepare(`INSERT INTO access_grants (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)`)
    .bind(await sha256Hex(token), email, isoIn(GRANT_TTL_MS), nowIso())
    .run();
  return token;
}

export async function checkGrant(db, token) {
  if (typeof token !== "string" || !token) return null;
  const row = await db
    .prepare(`SELECT email, expires_at FROM access_grants WHERE token_hash = ?`)
    .bind(await sha256Hex(token)).first();
  if (!row || expired(row.expires_at)) return null;
  return row.email;
}

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
