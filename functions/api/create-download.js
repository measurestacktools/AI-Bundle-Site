// GET /api/download?order_id=... — PAID gate, then streams the private ZIP
// straight from KV. Auth is re-checked on EVERY request (stronger than an
// expiring bearer URL: refunds/revocation take effect immediately).
// POST /api/create-download returns this same-origin URL.
import { isValidOrderId, readJsonBody, json, errorToResponse, rateLimit, clientIp, PRODUCT } from "../_lib/validate.js";
import { getOrderById } from "../_lib/db.js";

function downloadUrl(orderId) {
  return `/api/download?order_id=${encodeURIComponent(orderId)}`;
}

async function authorize(env, orderId) {
  if (!isValidOrderId(orderId)) {
    const err = new Error("Unknown order");
    err.status = 403;
    throw err;
  }
  const order = await getOrderById(env.DB, orderId);
  if (!order || order.status !== "PAID" || order.product_id !== PRODUCT.id) {
    const err = new Error("Download not available for this order");
    err.status = 403;
    throw err;
  }
  return order;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`dl:${clientIp(request)}`, 30)) {
      return json({ ok: false, error: "Too many requests" }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Unavailable" }, 503);
    const body = await readJsonBody(request);
    const order = await authorize(env, body.order_id);
    return json({ ok: true, url: downloadUrl(order.id) });
  } catch (err) {
    return errorToResponse(err);
  }
}
