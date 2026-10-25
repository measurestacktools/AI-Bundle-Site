// POST /api/auth/register — { email, password, name? }.
// Creates an email + password account (PBKDF2-SHA256, 16-byte salt, 100k
// iterations) and sets the same HttpOnly session cookie as Google sign-in.
// Duplicate emails are rejected with 409.
import {
  readJsonBody,
  json,
  errorToResponse,
  rateLimit,
  clientIp,
  isValidEmail,
} from "../../_lib/validate.js";
import {
  normalizeEmail,
  passwordProblem,
  findAccountByEmail,
  createPasswordAccount,
  createSession,
  sessionCookie,
  MAX_NAME_LENGTH,
} from "../../_lib/accounts.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`reg:${clientIp(request)}`, 10)) {
      return json({ ok: false, error: "Too many requests. Try again shortly." }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Accounts are not available right now." }, 503);

    const body = await readJsonBody(request);
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      return json({ ok: false, error: "Enter a valid email address." }, 400);
    }
    const problem = passwordProblem(body.password);
    if (problem) return json({ ok: false, error: problem }, 400);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length > MAX_NAME_LENGTH) {
      return json({ ok: false, error: `Name must be at most ${MAX_NAME_LENGTH} characters.` }, 400);
    }

    const existing = await findAccountByEmail(env.DB, email);
    if (existing) {
      const googleOnly = Boolean(existing.google_sub) && !String(existing.google_sub).startsWith("local:");
      return json(
        {
          ok: false,
          code: "account_exists",
          error: googleOnly
            ? "This email already has an account. Continue with Google instead."
            : "An account with this email already exists. Sign in instead.",
        },
        409
      );
    }

    let account;
    try {
      account = await createPasswordAccount(env.DB, { email, password: body.password, name });
    } catch (err) {
      // Lost a race against another registration for the same email.
      if (/unique/i.test(String((err && err.message) || ""))) {
        return json(
          { ok: false, code: "account_exists", error: "An account with this email already exists. Sign in instead." },
          409
        );
      }
      throw err;
    }

    const token = await createSession(env.DB, account.id);
    return json(
      { ok: true, account: { email: account.email, name: account.name, picture: null } },
      200,
      { "set-cookie": sessionCookie(token) }
    );
  } catch (err) {
    return errorToResponse(err);
  }
}
