// POST /api/verify-access-code — step 2 ({email, code}).
// On success returns a short-lived grant token plus the customer's own
// eligible orders. Every failure looks identical: no oracle for codes.
import {
  isValidEmail,
  readJsonBody,
  json,
  errorToResponse,
  rateLimit,
  clientIp,
  PRODUCT,
} from "../_lib/validate.js";
import {
  pruneAccessRows,
  findLiveCode,
  consumeCode,
  bumpCodeAttempts,
  codeLockedOut,
  createGrant,
  findPaidOrdersByEmail,
} from "../_lib/access.js";

export function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

const BAD = { ok: false, error: "Invalid or expired code" };

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`av:${clientIp(request)}`, 20)) {
      return json({ ok: false, error: "Too many requests" }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Unavailable" }, 503);
    const body = await readJsonBody(request);
    const email =
      typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      return json(BAD, 400);
    }
    if (await codeLockedOut(env.DB, email)) return json(BAD, 400);
    const row = await findLiveCode(env.DB, email, code);
    if (!row) {
      await bumpCodeAttempts(env.DB, email);
      return json(BAD, 400);
    }
    await consumeCode(env.DB, row.id);
    await pruneAccessRows(env.DB, email);
    const orders = await findPaidOrdersByEmail(env.DB, email, PRODUCT.id);
    const grantToken = await createGrant(env.DB, email);
    return json({
      ok: true,
      grant_token: grantToken,
      orders: orders.map((o) => ({
        order_id: o.id,
        product: o.product_id,
        paid_at: o.paid_at,
      })),
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
