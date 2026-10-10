// Cashfree PG REST client (server-side only; secrets stay in env).
// API version: v2026-01-01. Docs: https://www.cashfree.com/docs/api-reference/payments

function baseUrl(env) {
  return env.CASHFREE_ENVIRONMENT === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

function headers(env, extra = {}) {
  return {
    "content-type": "application/json",
    "x-api-version": "2026-01-01",
    "x-client-id": env.CASHFREE_APP_ID,
    "x-client-secret": env.CASHFREE_SECRET_KEY,
    ...extra,
  };
}

export function cashfreeConfigured(env) {
  return Boolean(env.CASHFREE_APP_ID && env.CASHFREE_SECRET_KEY);
}

async function parseOrThrow(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error("Cashfree request failed");
    err.status = 502;
    // Surface only the human message (never headers, keys, or full bodies).
    const msg = data && typeof data.message === "string" ? data.message.replace(/\s+/g, " ").slice(0, 120) : "";
    err.detail = msg ? `cf:${msg}` : `http_${res.status}`;
    throw err;
  }
  return data;
}

// POST /orders — creates a Cashfree order, returns {cf_order_id, order_id, payment_session_id, order_status}.
export async function cfCreateOrder(env, { orderId, amount, currency, email, phone, customerId, returnUrl, notifyUrl, note }) {
  const customer_details = {
    customer_id: customerId,
    customer_email: email,
    customer_name: "Bundle Customer",
  };
  if (phone) customer_details.customer_phone = phone;
  const res = await fetch(`${baseUrl(env)}/orders`, {
    method: "POST",
    headers: headers(env, { "x-idempotency-key": orderId }),
    body: JSON.stringify({
      order_id: orderId,
      order_amount: amount,
      order_currency: currency,
      customer_details,
      order_meta: { return_url: returnUrl, notify_url: notifyUrl },
      order_note: note || "AI Projects Bundle",
    }),
  });
  return parseOrThrow(res);
}

// GET /orders/{order_id} — canonical order status (ACTIVE | PAID | EXPIRED | ...).
export async function cfGetOrder(env, cashfreeOrderId) {
  const res = await fetch(`${baseUrl(env)}/orders/${encodeURIComponent(cashfreeOrderId)}`, {
    headers: headers(env),
  });
  return parseOrThrow(res);
}

// GET /orders/{order_id}/payments — payment attempts; SUCCESS entries confirm money.
export async function cfGetPayments(env, cashfreeOrderId) {
  const res = await fetch(`${baseUrl(env)}/orders/${encodeURIComponent(cashfreeOrderId)}/payments`, {
    headers: headers(env),
  });
  return parseOrThrow(res);
}
