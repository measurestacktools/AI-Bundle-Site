// POST /api/order-lookup — guest order tracking (order ID + checkout email).
// Security: same shape for bad-id / missing-row / email-mismatch (UNKNOWN),
// so the endpoint is not an oracle for order IDs or emails. Minimal reply:
// state + product, plus the existing success-page URL only on PAID.
// Download itself still gates on the live PAID row on every request.
import {
  isValidOrderId,
  isValidEmail,
  readJsonBody,
  json,
  errorToResponse,
  rateLimit,
  clientIp,
  PRODUCT,
} from "../_lib/validate.js";
import { getOrderById } from "../_lib/db.js";
import { safeEqual } from "../_lib/crypto.js";

export function normalizeLookupEmail(v) {
  return String(v || "").trim().toLowerCase();
}

// Customer-safe states only. Mirrors payment-status mapping; CANCELLED is
// read as failed (never written by current code, kept for forward-compat).
export function mapLookupState(status) {
  if (status === "PAID") return "PAID";
  if (status === "PAYMENT_FAILED" || status === "CANCELLED") return "PAYMENT_FAILED";
  return "PAYMENT_PENDING";
}

const UNKNOWN = { ok: true, state: "UNKNOWN" };

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`ol:${clientIp(request)}`, 20)) {
      return json({ ok: false, error: "Too many requests" }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Unavailable" }, 503);
    const body = await readJsonBody(request);
    const orderId = String(body.order_id || "");
    const email = normalizeLookupEmail(body.email);
    // Generic reply for malformed input too: no oracle.
    if (!isValidOrderId(orderId) || !isValidEmail(email)) return json(UNKNOWN);
    const order = await getOrderById(env.DB, orderId);
    if (!order || order.product_id !== PRODUCT.id) return json(UNKNOWN);
    if (!safeEqual(normalizeLookupEmail(order.email), email)) return json(UNKNOWN);
    const state = mapLookupState(order.status);
    const res = { ok: true, state, product: PRODUCT.id };
    if (state === "PAID") {
      res.purchase_url = `/success.html?oid=${encodeURIComponent(order.id)}`;
    }
    return json(res);
  } catch (err) {
    return errorToResponse(err);
  }
}
