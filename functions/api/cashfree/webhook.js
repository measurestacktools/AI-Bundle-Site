// POST /api/cashfree/webhook — Cashfree PG payment events. SECURITY-CRITICAL.
// 1) verify HMAC signature, 2) idempotent ingest, 3) server-side payment
// verification via Cashfree API, 4) mark PAID only on confirmed SUCCESS.
import { json } from "../../_lib/validate.js";
import { verifyCashfreeWebhook, sha256Hex } from "../../_lib/crypto.js";
import { getOrderByCfId, setStatus, claimEvent, releaseEvent, nowIso } from "../../_lib/db.js";
import { cfGetPayments } from "../../_lib/cashfree.js";
import { sendPurchaseEmail, emailConfigured } from "../../_lib/email.js";
import { PRODUCT } from "../../_lib/validate.js";

const SUCCESS_TYPES = new Set(["PAYMENT_SUCCESS_WEBHOOK", "PAYMENT_SUCCESS"]);
const FAIL_TYPES = new Set(["PAYMENT_FAILED_WEBHOOK", "PAYMENT_FAILED", "PAYMENT_USER_DROPPED_WEBHOOK", "PAYMENT_USER_DROPPED"]);

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > 64 * 1024) return json({ ok: false }, 400);

    const signature = request.headers.get("x-webhook-signature") || "";
    const timestamp = request.headers.get("x-webhook-timestamp") || "";
    const ok = await verifyCashfreeWebhook({
      signature, timestamp, rawBody, secret: env.CASHFREE_SECRET_KEY,
    });
    if (!ok) {
      console.log("[webhook] invalid signature");
      return json({ ok: false, error: "invalid signature" }, 401);
    }

    let evt;
    try {
      evt = JSON.parse(rawBody);
    } catch {
      return json({ ok: false }, 400);
    }

    // NOTE on timestamp: shape-checked in verify (numeric). We deliberately do
    // NOT enforce a freshness window: Cashfree retries webhooks for hours, and
    // replay protection comes from the idempotency ledger + server-side
    // payment verification below, which a replayed SUCCESS cannot forge.
    const type = String(evt.type || "");
    const cfOrderId = String(evt?.data?.order?.order_id || "");
    const cfPaymentId = String(evt?.data?.payment?.cf_payment_id || "");
    if (!cfOrderId) return json({ ok: false }, 400);

    // Idempotency: cf_payment_id is the dedupe key; fallback binds the raw body
    // hash so distinct events can never share a key.
    const eventKey = cfPaymentId
      ? `pay:${cfPaymentId}`
      : `evt:${type}:${cfOrderId}:${await sha256Hex(rawBody)}`;
    if (!(await claimEvent(env.DB, eventKey, { cashfreeOrderId: cfOrderId, eventType: type }))) {
      return json({ ok: true, deduped: true });
    }

    const order = await getOrderByCfId(env.DB, cfOrderId);
    if (!order) {
      console.log("[webhook] unknown order");
      await releaseEvent(env.DB, eventKey);
      return json({ ok: true, ignored: true });
    }
    if (order.status === "PAID") return json({ ok: true, already_paid: true });

    if (SUCCESS_TYPES.has(type)) {
      // Never trust the webhook alone: confirm money server-side.
      let payments = null;
      try {
        payments = await cfGetPayments(env, cfOrderId);
      } catch (e) {
        console.log("[webhook] payments lookup failed");
        await releaseEvent(env.DB, eventKey); // let the retry re-verify
        return json({ ok: false, error: "verification unavailable" }, 502);
      }
      const list = Array.isArray(payments) ? payments : payments?.data || [];
      const good = list.find(
        (p) =>
          p.payment_status === "SUCCESS" &&
          Number(p.payment_amount) === PRODUCT.price &&
          String(p.payment_currency || p.order_currency || "INR").toUpperCase() === PRODUCT.currency
      );
      if (!good) {
        console.log("[webhook] no confirmed payment");
        await releaseEvent(env.DB, eventKey); // not terminal: allow re-check
        return json({ ok: true, unverified: true });
      }
      const paidAt = nowIso();
      await setStatus(env.DB, order.id, "PAID", {
        paidAt,
        cfPaymentId: String(good.cf_payment_id || cfPaymentId || ""),
        paymentReference: String(good.bank_reference || good.cf_payment_id || ""),
        fulfillment: "PENDING",
      });

      // Fulfillment email (tracked, never faked).
      const siteUrl = (env.SITE_URL || "https://aiprojectsbundle.pages.dev").replace(/\/$/, "");
      const mail = await sendPurchaseEmail(env, {
        to: order.email,
        orderId: order.id,
        downloadUrl: `${siteUrl}/success.html?oid=${encodeURIComponent(order.id)}`,
        siteUrl,
      });
      await setStatus(env.DB, order.id, "PAID", {
        fulfillment: mail.sent ? "SENT" : "PENDING",
        emailStatus: mail.sent ? "SENT" : emailConfigured(env) ? "FAILED" : "SKIPPED",
      });
      // NOTE: download URL is minted on demand (create-download), never emailed directly.
      return json({ ok: true, paid: true, email: mail.sent ? "sent" : "not_sent" });
    }

    if (FAIL_TYPES.has(type)) {
      if (order.status !== "PAID") await setStatus(env.DB, order.id, "PAYMENT_FAILED");
      return json({ ok: true, failed: true });
    }

    return json({ ok: true, ignored: true });
  } catch (err) {
    console.log("[webhook] error");
    return json({ ok: false }, 500);
  }
}
