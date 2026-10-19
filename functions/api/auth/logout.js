// POST /api/auth/logout — revokes the session server-side and clears the cookie.
import { json, errorToResponse } from "../../_lib/validate.js";
import { readSessionToken, deleteSession, clearSessionCookie } from "../../_lib/accounts.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (env.DB) await deleteSession(env.DB, readSessionToken(request));
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  } catch (err) {
    return errorToResponse(err);
  }
}
