// GET /api/download?order_id=... — same PAID gate, streams ZIP bytes.
// GET /api/download?token=... — single-use, 10-minute token minted for a
// verified purchase-access grant (repeat downloads). The PAID row is
// re-checked at redeem time, so revocation still takes effect immediately.
import { isValidOrderId, json, rateLimit, clientIp, PRODUCT } from "../_lib/validate.js";
import { getOrderById, recordDownload } from "../_lib/db.js";
import { redeemDownloadToken } from "../_lib/access.js";
import { getBundleBytes, zipResponse } from "../_lib/blob.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!rateLimit(`dlg:${clientIp(request)}`, 30)) {
    return json({ ok: false, error: "Too many requests" }, 429);
  }
  if (!env.DB) return json({ ok: false, error: "Unavailable" }, 503);
  const params = new URL(request.url).searchParams;
  let orderId = params.get("order_id") || "";
  if (params.get("token")) {
    const redeemed = await redeemDownloadToken(env.DB, params.get("token"));
    if (!redeemed) return json({ ok: false }, 403);
    orderId = redeemed;
  }
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
