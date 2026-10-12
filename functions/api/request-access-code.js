// POST /api/request-access-code — step 1 of purchase access ({email}).
// Anti-enumeration: the reply is IDENTICAL whether or not a PAID order
// exists for the email. Codes are random 6-digit, stored hashed, expire in
// 10 minutes, single-use, max 5 attempts. Email required: without a
// configured provider we answer honestly instead of faking a code.
import {
  isValidEmail,
  readJsonBody,
  json,
  errorToResponse,
  rateLimit,
  clientIp,
  PRODUCT,
} from "../_lib/validate.js";
import { emailConfigured, sendAccessCode } from "../_lib/email.js";
import {
  pruneAccessRows,
  lastCodeAt,
  createAccessCode,
  findPaidOrdersByEmail,
  CODE_RESEND_COOLDOWN_MS,
} from "../_lib/access.js";

const SENT_MESSAGE =
  "If an eligible purchase exists for this email, a 6-digit code is on its way (valid 10 minutes).";

export function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`ac:${clientIp(request)}`, 10)) {
      return json({ ok: false, error: "Too many requests" }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Unavailable" }, 503);
    if (!emailConfigured(env)) {
      return json(
        {
          ok: false,
          error: "Email delivery is not configured yet, so access codes can't be sent. Contact support for help with your download.",
          code: "email_unavailable",
        },
        503
      );
    }
    const body = await readJsonBody(request);
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      return json({ ok: false, error: "Enter a valid email address" }, 400);
    }
    await pruneAccessRows(env.DB, email);
    // Cooldown without oracle: behave as if sent.
    if (Date.now() - (await lastCodeAt(env.DB, email)) < CODE_RESEND_COOLDOWN_MS) {
      return json({ ok: true, message: SENT_MESSAGE });
    }
    const orders = await findPaidOrdersByEmail(env.DB, email, PRODUCT.id);
    if (orders.length === 0) return json({ ok: true, message: SENT_MESSAGE });
    const code = await createAccessCode(env.DB, email);
    const res = await sendAccessCode(env, { to: email, code });
    if (!res.sent) console.log(`[access] code send failed: ${res.reason}`);
    return json({ ok: true, message: SENT_MESSAGE });
  } catch (err) {
    return errorToResponse(err);
  }
}
