// Customer accounts (Google Sign-In) + server-side sessions.
// Security model:
//  - The browser gets a Google ID token (JWT). We NEVER trust its claims
//    until the RS256 signature is verified against Google's live JWKS.
//  - Sessions are opaque random tokens; only their SHA-256 hash is stored.
//  - Session cookie is HttpOnly + Secure + SameSite=Lax, so JS can't read it
//    and cross-site POSTs don't carry it.
import { nowIso } from "./db.js";
import { sha256Hex, randomHex } from "./crypto.js";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = "aib_session";

const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const JWKS_MAX_AGE_MS = 60 * 60 * 1000; // Google rotates keys; 1h is safe

let jwksCache = { keys: null, fetchedAt: 0 };

export function googleConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID);
}

export function sessionCookie(token, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSessionToken(request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function googleKeys() {
  if (jwksCache.keys && Date.now() - jwksCache.fetchedAt < JWKS_MAX_AGE_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error("jwks_unavailable");
  const data = await res.json();
  if (!Array.isArray(data.keys) || data.keys.length === 0) throw new Error("jwks_empty");
  jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

// Verifies a Google ID token end-to-end. Returns claims or null.
// Checks: structure, alg=RS256, kid match, RS256 signature, iss, aud,
// exp/iat, and a non-empty verified email.
export async function verifyGoogleIdToken(idToken, clientId) {
  if (typeof idToken !== "string" || !idToken || !clientId) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    return null;
  }
  if (!header || header.alg !== "RS256" || !header.kid) return null;
  if (!claims || typeof claims !== "object") return null;

  let keys;
  try {
    keys = await googleKeys();
  } catch {
    return null;
  }
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) return null;

  let key;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    return null;
  }

  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.has(claims.iss)) return null;
  if (claims.aud !== clientId) return null;
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.iat === "number" && claims.iat > now + 300) return null;
  if (!claims.sub || typeof claims.sub !== "string") return null;
  if (!claims.email || typeof claims.email !== "string") return null;
  if (claims.email_verified !== true && claims.email_verified !== "true") return null;

  return claims;
}

export async function upsertAccount(db, claims) {
  const email = String(claims.email).trim().toLowerCase();
  const now = nowIso();
  const existing = await db
    .prepare(`SELECT id FROM accounts WHERE google_sub = ?`)
    .bind(claims.sub)
    .first();
  if (existing) {
    await db
      .prepare(`UPDATE accounts SET email = ?, name = ?, picture = ?, last_login_at = ? WHERE id = ?`)
      .bind(email, claims.name || null, claims.picture || null, now, existing.id)
      .run();
    return existing.id;
  }
  const id = `acc_${randomHex(12)}`;
  await db
    .prepare(
      `INSERT INTO accounts (id, google_sub, email, name, picture, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, claims.sub, email, claims.name || null, claims.picture || null, now, now)
    .run();
  return id;
}

export async function createSession(db, accountId) {
  const token = randomHex(32);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, account_id, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      await sha256Hex(token),
      accountId,
      new Date(now + SESSION_TTL_MS).toISOString(),
      new Date(now).toISOString(),
      new Date(now).toISOString()
    )
    .run();
  return token;
}

export async function getSessionAccount(db, token) {
  if (typeof token !== "string" || !token) return null;
  const hash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.account_id, s.expires_at, a.id, a.email, a.name, a.picture
       FROM sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = ?`
    )
    .bind(hash)
    .first();
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(hash).run();
    return null;
  }
  // Lightweight sliding refresh (at most once a day) to avoid a write per request.
  const now = Date.now();
  if (now - Date.parse(row.expires_at) < SESSION_TTL_MS - 24 * 60 * 60 * 1000) {
    await db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`).bind(nowIso(), hash).run();
  }
  return { account_id: row.account_id, email: row.email, name: row.name, picture: row.picture };
}

export async function deleteSession(db, token) {
  if (!token) return;
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256Hex(token)).run();
}

export async function findOrdersForAccount(db, email, productId) {
  const res = await db
    .prepare(
      `SELECT id, product_id, status, paid_at FROM orders
       WHERE email = ? AND product_id = ? AND status = 'PAID'
       ORDER BY paid_at DESC LIMIT 20`
    )
    .bind(email, productId)
    .all();
  return res?.results || [];
}
