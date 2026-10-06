// GET /api/payment-status?order_id=... — what the success page polls.
// Returns ONLY customer-safe state. Success here means the DURABLE row is PAID
// (set exclusively by the verified webhook path), never browser claims.
import { isValidOrderId, json, errorToResponse, rateLimit, clientIp } from "../_lib/validate.js";
import { getOrderById } from "../_lib/db.js";

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`ps:${clientIp(request)}`, 60)) {
      return json({ ok: false, error: "Too many requests" }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Unavailable" }, 503);
    const orderId = new URL(request.url).searchParams.get("order_id") || "";
    if (!isValidOrderId(orderId)) return json({ ok: false, state: "UNKNOWN" }, 400);

  const order = await getOrderById(env.DB, orderId);
  if (!order) return json({ ok: true, state: "UNKNOWN" });

  if (order.status === "PAID") {
    return json({
      ok: true,
      state: "PAID",
      email_sent: order.email_status === "SENT",
      product: "ai-projects-bundle",
    });
  }
  if (order.status === "PAYMENT_FAILED" || order.status === "CANCELLED") {
    return json({ ok: true, state: "PAYMENT_FAILED" });
  }
  return json({ ok: true, state: "PAYMENT_PENDING" });
  } catch (err) {
    return errorToResponse(err);
  }
}
