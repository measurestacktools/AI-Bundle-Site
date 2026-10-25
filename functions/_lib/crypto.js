// Shared crypto helpers (WebCrypto; works in Workers/Pages Functions and Node 18+).
const te = new TextEncoder();

export function randomHex(bytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Internal order id: short, unguessable, Cashfree-compatible ([A-Za-z0-9_-], <=45).
export function newOrderId() {
  return `aib_${Date.now().toString(36)}_${randomHex(8)}`;
}

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", te.encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Password hashing (email + password accounts).
// PBKDF2-SHA256, 100k iterations (the Workers maximum), 16-byte random salt,
// 32-byte derived key. Only the salt/iterations/hash are stored — never the
// password itself.
export const PASSWORD_ITERATIONS = 100000;
export const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BITS = 256;

export function hexToBytes(hex) {
  const clean = String(hex || "");
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function pbkdf2Hex(password, saltHex, iterations = PASSWORD_ITERATIONS) {
  const salt = hexToBytes(saltHex);
  if (!salt.length) throw new Error("invalid_salt");
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(String(password)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    PASSWORD_KEY_BITS
  );
  return [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Constant-time string compare for signatures.
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Cashfree PG webhook verification:
//   expected = base64( HMAC_SHA256( timestamp + rawBody, secretKey ) )
export async function hmacSha256Base64(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(message));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export async function verifyCashfreeWebhook({ signature, timestamp, rawBody, secret }) {
  if (!signature || !timestamp || !rawBody || !secret) return false;
  // Basic timestamp sanity: must be numeric (Cashfree sends epoch millis as string).
  if (!/^\d{10,16}$/.test(String(timestamp).trim())) return false;
  const expected = await hmacSha256Base64(secret, String(timestamp) + rawBody);
  return safeEqual(expected, signature);
}
