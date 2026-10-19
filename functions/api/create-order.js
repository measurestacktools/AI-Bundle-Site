// POST /api/create-order — signed-in customers only.
// Price ALWAYS comes from server-side PRODUCT. The browser can never set it,
// and the purchase email ALWAYS comes from the verified session cookie, so a
// customer cannot buy under an email they do not control.
import { PRODUCT, json, errorToResponse, rateLimit, clientIp, normalizePhone, isValidPhone } from "../_lib/validate.js";
import { newOrderId, sha256Hex } from "../_lib/crypto.js";
import { createOrderRow } from "../_lib/db.js";
import { cashfreeConfigured, cfCreateOrder } from "../_lib/cashfree.js";
import { readSessionToken, getSessionAccount, findOrdersForAccount } from "../_lib/accounts.js";

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

    // One purchase per account: if this account already owns the bundle, do not
    // start another payment — point them at their existing download instead.
    const owned = await findOrdersForAccount(env.DB, account.account_id, email, PRODUCT.id);
    const alreadyPaid = owned.find((o) => o.status === "PAID");
    if (alreadyPaid) {
      return json(
        {
          ok: false,
          reason: "already_purchased",
          error: "You already own this bundle — download it from your Orders page.",
          order_id: alreadyPaid.id,
        },
        409
      );
    }

    const body = await request.json().catch(() => ({}));
    const phone = normalizePhone(body && body.phone);
    if (!isValidPhone(phone)) return json({ ok: false, error: "Enter a valid 10-digit mobile number" }, 400);

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
        phone,
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
      phone,
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
