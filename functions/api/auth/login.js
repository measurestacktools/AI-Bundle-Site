// POST /api/auth/login — { email, password }.
// Verifies the PBKDF2 hash, then sets the same HttpOnly session cookie used by
// Google sign-in. Unknown emails and wrong passwords share one generic 401 so
// the endpoint does not confirm which addresses have accounts.
import { readJsonBody, json, errorToResponse, rateLimit, clientIp, isValidEmail } from "../../_lib/validate.js";
import {
  normalizeEmail,
  passwordProblem,
  verifyPasswordAccount,
  createSession,
  sessionCookie,
} from "../../_lib/accounts.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`login:${clientIp(request)}`, 20)) {
      return json({ ok: false, error: "Too many sign-in attempts. Try again shortly." }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Accounts are not available right now." }, 503);

    const body = await readJsonBody(request);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    if (!isValidEmail(email) || passwordProblem(password)) {
      return json({ ok: false, error: "Incorrect email or password." }, 401);
    }

    const account = await verifyPasswordAccount(env.DB, email, password);
    if (!account) {
      return json(
        {
          ok: false,
          error: "Incorrect email or password. If you created this account with Google, use Continue with Google.",
        },
        401
      );
    }

    const token = await createSession(env.DB, account.account_id);
    return json(
      {
        ok: true,
        account: { email: account.email, name: account.name || null, picture: account.picture || null },
      },
      200,
      { "set-cookie": sessionCookie(token) }
    );
  } catch (err) {
    return errorToResponse(err);
  }
}
