// POST /api/create-download  { order_id } -> { url, expires_in }
// GET  /api/download?order_id=... -> 302 to a fresh signed URL.
// PAID-only gate. Anything else: 403. No order data leaks in errors.
import { isValidOrderId, readJsonBody, json, errorToResponse, rateLimit, clientIp, PRODUCT } from "../_lib/validate.js";
import { getOrderById, recordDownload } from "../_lib/db.js";
import { presignedR2GetUrl } from "../_lib/r2sign.js";

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

async function mint(env, order) {
  const url = await presignedR2GetUrl(env, 1800);
  await recordDownload(env.DB, order.id);
  return url;
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
    const url = await mint(env, order);
    return json({ ok: true, url, expires_in: 1800 });
  } catch (err) {
    if (err.message === "R2 storage is not configured") return json({ ok: false, error: "Unavailable" }, 503);
    return errorToResponse(err);
  }
}
