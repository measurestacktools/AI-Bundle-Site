// POST /api/account/download — { order_id }.
// Signed-in equivalent of create-download-token: the session cookie identifies
// the account, and the order must be PAID, same product, and owned by that
// account's verified email. Mints the same single-use 10-minute token.
import {
  isValidOrderId,
  readJsonBody,
  json,
  errorToResponse,
  rateLimit,
  clientIp,
  PRODUCT,
} from "../../_lib/validate.js";
import { getOrderById } from "../../_lib/db.js";
import { readSessionToken, getSessionAccount, orderBelongsToAccount } from "../../_lib/accounts.js";
import { createDownloadToken } from "../../_lib/access.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`adl:${clientIp(request)}`, 20)) {
      return json({ ok: false, error: "Too many requests" }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Unavailable" }, 503);
    const account = await getSessionAccount(env.DB, readSessionToken(request));
    if (!account) return json({ ok: false }, 403);
    const body = await readJsonBody(request);
    const orderId = String(body.order_id || "");
    if (!isValidOrderId(orderId)) return json({ ok: false }, 403);
    const order = await getOrderById(env.DB, orderId);
    if (
      !order ||
      order.status !== "PAID" ||
      order.product_id !== PRODUCT.id ||
      !orderBelongsToAccount(order, account)
    ) {
      return json({ ok: false }, 403);
    }
    const token = await createDownloadToken(env.DB, order.id);
    return json({ ok: true, url: `/api/download?token=${encodeURIComponent(token)}` });
  } catch (err) {
    return errorToResponse(err);
  }
}
