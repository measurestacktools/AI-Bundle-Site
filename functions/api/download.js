// GET /api/download?order_id=... — same PAID gate, streams ZIP bytes.
import { isValidOrderId, json, rateLimit, clientIp, PRODUCT } from "../_lib/validate.js";
import { getOrderById, recordDownload } from "../_lib/db.js";
import { getBundleBytes, zipResponse } from "../_lib/blob.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!rateLimit(`dlg:${clientIp(request)}`, 30)) {
    return json({ ok: false, error: "Too many requests" }, 429);
  }
  if (!env.DB) return json({ ok: false, error: "Unavailable" }, 503);
  const orderId = new URL(request.url).searchParams.get("order_id") || "";
  if (!isValidOrderId(orderId)) return json({ ok: false }, 403);
  const order = await getOrderById(env.DB, orderId);
  if (!order || order.status !== "PAID" || order.product_id !== PRODUCT.id) {
    return json({ ok: false }, 403);
  }
  try {
    const bytes = await getBundleBytes(env);
    if (!bytes) return json({ ok: false, error: "Unavailable" }, 503);
    await recordDownload(env.DB, order.id);
    return zipResponse(bytes);
  } catch {
    return json({ ok: false, error: "Unavailable" }, 503);
  }
}
