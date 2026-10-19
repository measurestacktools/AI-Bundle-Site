// GET /api/auth/session — who is signed in (cookie-based), plus their orders.
// Returns 200 with { ok:true, account:null } when signed out: a normal state,
// not an error, so the UI can render the signed-out header without a 401.
import { json, errorToResponse, PRODUCT } from "../../_lib/validate.js";
import { readSessionToken, getSessionAccount, findOrdersForAccount } from "../../_lib/accounts.js";

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    if (!env.DB) return json({ ok: true, account: null, orders: [], configured: false });
    const account = await getSessionAccount(env.DB, readSessionToken(request));
    if (!account) return json({ ok: true, account: null, orders: [], configured: Boolean(env.GOOGLE_CLIENT_ID) });
    const orders = await findOrdersForAccount(env.DB, account.email, PRODUCT.id);
    return json({
      ok: true,
      configured: Boolean(env.GOOGLE_CLIENT_ID),
      account: {
        email: account.email,
        name: account.name || null,
        picture: account.picture || null,
      },
      orders: orders.map((o) => ({ order_id: o.id, paid_at: o.paid_at })),
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
