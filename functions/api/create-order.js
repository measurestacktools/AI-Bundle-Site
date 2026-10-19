// POST /api/create-order — signed-in customers only.
// Price ALWAYS comes from server-side PRODUCT. The browser can never set it,
// and the purchase email ALWAYS comes from the verified session cookie, so a
// customer cannot buy under an email they do not control.
import { PRODUCT, json, errorToResponse, rateLimit, clientIp } from "../_lib/validate.js";
import { newOrderId, sha256Hex } from "../_lib/crypto.js";
import { createOrderRow } from "../_lib/db.js";
import { cashfreeConfigured, cfCreateOrder } from "../_lib/cashfree.js";
import { readSessionToken, getSessionAccount } from "../_lib/accounts.js";

// Cashfree requires a customer_phone value on the order object. Customers are
// never asked for a mobile number; a fixed dummy value satisfies the API
// (Cashfree explicitly allows dummy customer details).
const DUMMY_PHONE = "9999999999";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`co:${clientIp(request)}`, 20)) {
      return json({ ok: false, error: "Too many requests, try again shortly" }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Checkout is not configured yet" }, 503);
    if (!cashfreeConfigured(env)) return json({ ok: false, error: "Checkout is not configured yet" }, 503);

    const account = await getSessionAccount(env.DB, readSessionToken(request));
    if (!account) return json({ ok: false, error: "Sign in with Google to continue" }, 401);
    const email = String(account.email || "").trim().toLowerCase();
    if (!email) return json({ ok: false, error: "Sign in with Google to continue" }, 401);

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
        phone: DUMMY_PHONE,
        customerId,
        customerName: account.name || "Bundle Customer",
        returnUrl: `${siteUrl}/success.html?oid=${encodeURIComponent(internalId)}`.slice(0, 250),
        notifyUrl: `${siteUrl}/api/cashfree/webhook`.slice(0, 250),
        note: "AI Projects Bundle",
      });
    } catch (e) {
      console.log(`[create-order] cashfree failed: ${e.detail || "unknown"}`);
      const hint = typeof e.detail === "string" && e.detail.startsWith("cf:") ? ` (${e.detail.slice(3, 120)})` : "";
      return json({ ok: false, error: "Could not start payment, please try again" + hint }, 502);
    }
    if (!cf || !cf.payment_session_id || !cf.order_id) {
      return json({ ok: false, error: "Could not start payment, please try again" }, 502);
    }

    await createOrderRow(env.DB, {
      id: internalId,
      cashfreeOrderId: String(cf.order_id),
      email,
      accountId: account.account_id,
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
