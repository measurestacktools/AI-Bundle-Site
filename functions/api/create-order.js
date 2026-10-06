// POST /api/create-order  { email } -> { order_id, payment_session_id, cf_order_id, amount, currency, mode }
// Price ALWAYS comes from server-side PRODUCT. The browser can never set it.
import { PRODUCT, isValidEmail, readJsonBody, json, errorToResponse, rateLimit, clientIp } from "../_lib/validate.js";
import { newOrderId, sha256Hex } from "../_lib/crypto.js";
import { createOrderRow } from "../_lib/db.js";
import { cashfreeConfigured, cfCreateOrder } from "../_lib/cashfree.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`co:${clientIp(request)}`, 20)) {
      return json({ ok: false, error: "Too many requests, try again shortly" }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Checkout is not configured yet" }, 503);
    if (!cashfreeConfigured(env)) return json({ ok: false, error: "Checkout is not configured yet" }, 503);

    const body = await readJsonBody(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!isValidEmail(email)) return json({ ok: false, error: "Enter a valid email address" }, 400);

    const siteUrl = (env.SITE_URL || "https://aiprojectsbundle.pages.dev").replace(/\/$/, "");
    const internalId = newOrderId();
    // Cashfree order id: unique per request; ties webhook/payment back to our row.
    const cfOrderId = `aib${Date.now().toString(36)}${internalId.slice(-8)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    const emailHash = await sha256Hex(email);
    const customerId = `c${emailHash.slice(0, 20)}`;

    let cf;
    try {
      cf = await cfCreateOrder(env, {
        orderId: cfOrderId,
        amount: PRODUCT.price,
        currency: PRODUCT.currency,
        email,
        customerId,
        returnUrl: `${siteUrl}/success.html?oid=${encodeURIComponent(internalId)}`.slice(0, 250),
        notifyUrl: `${siteUrl}/api/cashfree/webhook`.slice(0, 250),
        note: "AI Projects Bundle",
      });
    } catch (e) {
      console.log(`[create-order] cashfree failed: ${e.detail || "unknown"}`);
      return json({ ok: false, error: "Could not start payment, please try again" }, 502);
    }
    if (!cf || !cf.payment_session_id || !cf.order_id) {
      return json({ ok: false, error: "Could not start payment, please try again" }, 502);
    }

    await createOrderRow(env.DB, {
      id: internalId,
      cashfreeOrderId: String(cf.order_id),
      email,
      productId: PRODUCT.id,
      amount: PRODUCT.price,
      currency: PRODUCT.currency,
    });

    return json({
      ok: true,
      order_id: internalId,
      payment_session_id: cf.payment_session_id,
      cf_order_id: String(cf.order_id),
      amount: PRODUCT.price,
      currency: PRODUCT.currency,
      mode: env.CASHFREE_ENVIRONMENT === "production" ? "production" : "sandbox",
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
