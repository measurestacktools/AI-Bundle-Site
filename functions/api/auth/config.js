// GET /api/auth/config — public auth configuration for the browser.
// The Google client ID is public by design; the client secret is never used
// (GIS ID-token flow) and never exposed.
import { json, errorToResponse, PRODUCT } from "../../_lib/validate.js";

export async function onRequestGet(context) {
  try {
    const env = (context && context.env) || {};
    return json({
      ok: true,
      google_client_id: env.GOOGLE_CLIENT_ID || null,
      price: PRODUCT.price,
      currency: PRODUCT.currency,
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
