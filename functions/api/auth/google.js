// POST /api/auth/google — { credential } (Google ID token from GIS).
// Verifies the token server-side against Google's JWKS, creates/updates the
// account, and sets an HttpOnly session cookie. Never trusts client claims.
import { readJsonBody, json, errorToResponse, rateLimit, clientIp } from "../../_lib/validate.js";
import {
  googleConfigured,
  verifyGoogleIdToken,
  upsertAccount,
  createSession,
  sessionCookie,
} from "../../_lib/accounts.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!rateLimit(`gsi:${clientIp(request)}`, 20)) {
      return json({ ok: false, error: "Too many requests" }, 429);
    }
    if (!env.DB) return json({ ok: false, error: "Unavailable" }, 503);
    if (!googleConfigured(env)) {
      return json(
        { ok: false, error: "Google sign-in is not configured yet.", code: "google_unavailable" },
        503
      );
    }
    const body = await readJsonBody(request);
    const claims = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
    if (!claims) return json({ ok: false, error: "Sign-in could not be verified." }, 401);

    const accountId = await upsertAccount(env.DB, claims);
    const token = await createSession(env.DB, accountId);
    return json(
      {
        ok: true,
        account: {
          email: String(claims.email).toLowerCase(),
          name: claims.name || null,
          picture: claims.picture || null,
        },
      },
      200,
      { "set-cookie": sessionCookie(token) }
    );
  } catch (err) {
    return errorToResponse(err);
  }
}
