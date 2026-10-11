// Request validation helpers. No secrets here.
export const PRODUCT = Object.freeze({
  id: "ai-projects-bundle",
  name: "AI Projects Bundle",
  price: 249,
  currency: "INR",
});

export const MAX_BODY_BYTES = 8 * 1024;

export function isValidEmail(email) {
  if (typeof email !== "string") return false;
  const e = email.trim();
  if (e.length < 5 || e.length > 254) return false;
  // Practical RFC-ish check: one @, dot in domain, no spaces/control chars.
  return /^[^\s@<>(),;:\\"[\]]+@[^\s@<>(),;:\\"[\]]+\.[^\s@<>(),;:\\"[\]]{2,}$/.test(e);
}

export function isValidOrderId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const text = await request.text();
  if (text.length > maxBytes) {
    const err = new Error("Body too large");
    err.status = 413;
    throw err;
  }
  if (!text) {
    const err = new Error("Empty body");
    err.status = 400;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error("Malformed JSON");
    err.status = 400;
    throw err;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function errorToResponse(err) {
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  const safe = status >= 500 ? "Internal error" : String(err.message || "Bad request");
  return json({ ok: false, error: safe }, status);
}

// Minimal per-isolate rate limiter (defense in depth, not a substitute for WAF).
const buckets = new Map();
export function rateLimit(key, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.reset) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 5000) buckets.clear();
  return b.count <= limit;
}

export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}
