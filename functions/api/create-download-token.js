// POST /api/create-download-token — step 3 ({grant_token, order_id}).
// Mints a single-use, 10-minute download URL for a PAID order whose email
// matches the verified grant. Repeat downloads NEVER create new orders.
import {
  isValidOrderId,
  readJsonBody,
  json,
  errorToResponse,
  rateLimit,
  clientIp,
  PRODUCT,
} from "../_lib/validate.js";
import { getOrderById } from "../_lib/db.js";
import { checkGrant, createDownloadToken } from "../_lib/access.js";
import { normalizeEmail } from "./verify-access-code.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`dt:${clientIp(request)}`, 20)) {
      return json({ ok: false, error: "Too many requests" }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Unavailable" }, 503);
    const body = await readJsonBody(request);
    const orderId = String(body.order_id || "");
    if (!isValidOrderId(orderId)) return json({ ok: false }, 403);
    const email = await checkGrant(env.DB, body.grant_token);
    if (!email) return json({ ok: false }, 403);
    const order = await getOrderById(env.DB, orderId);
    // Re-check everything at mint time: PAID row, same product, same owner.
    if (
      !order ||
      order.status !== "PAID" ||
      order.product_id !== PRODUCT.id ||
      normalizeEmail(order.email) !== email
    ) {
      return json({ ok: false }, 403);
    }
    const token = await createDownloadToken(env.DB, order.id);
    return json({ ok: true, url: `/api/download?token=${encodeURIComponent(token)}` });
  } catch (err) {
    return errorToResponse(err);
  }
}
