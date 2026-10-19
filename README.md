# AI Bundle — Sales Site

Landing page + Cloudflare Pages Functions for the AI Projects Bundle (₹249).
Buying requires signing in with Google: checkout has no email or mobile form,
the order email comes from the verified session, and every purchase is saved to
the account so the Orders page can re-download it any time. Payment runs through
Cashfree and the ZIP is delivered from Workers KV behind a D1 PAID gate.

## Pages

`index`, `bundle`, `success`, `account` (Orders), `contact`, `refund`,
`privacy`. Static assets live in `assets/`; the built ZIP is never served as a
file — the only read path is `/api/download` after a PAID check.

## API (Pages Functions)

- `POST /api/create-order` — signed-in only; email comes from the session,
  amount always from the server, Cashfree gets a dummy phone.
- `GET /api/payment-status` — polls the order status for `success.html`.
- `POST /api/cashfree/webhook` — HMAC-verified, idempotent PAID marker.
- `POST /api/create-download` / `GET /api/download` — single-use 10-minute tokens.
- `GET /api/auth/config`, `POST /api/auth/google`, `POST /api/auth/logout`,
  `GET /api/auth/session`, `POST /api/account/download` — Google accounts + orders.

The Google flow uses the GIS **ID-token** flow: the browser posts a signed
Google JWT, and the Function verifies it against Google's JWKS. There is no
client secret. Sessions are random tokens stored as SHA-256 hashes and sent as
an `HttpOnly; Secure; SameSite=Lax` cookie. `/api/auth/session` returns the
account's orders with their status, which drives automatic tracking on the
Orders page.

## Run locally

Static-only preview (no API):

```powershell
cd AI-Bundle-Site
python -m http.server 8080
```

Full local stack (Functions + local D1/KV):

```powershell
npx wrangler d1 execute ai-bundle-orders --local --config wrangler.local.toml --file migrations/0001_init.sql
npx wrangler d1 execute ai-bundle-orders --local --config wrangler.local.toml --file migrations/0002_access.sql
npx wrangler d1 execute ai-bundle-orders --local --config wrangler.local.toml --file migrations/0003_accounts.sql
npx wrangler d1 execute ai-bundle-orders --local --config wrangler.local.toml --file migrations/0004_order_account.sql
```

`wrangler pages dev` only accepts `wrangler.toml`, so swap `wrangler.local.toml`
in temporarily if you need the full stack locally. Put local-only values such as
`GOOGLE_CLIENT_ID` in `.dev.vars` (git-ignored).

## Tests

```powershell
node scripts/test-step3.mjs   # order price/webhook/secret-scan
node scripts/test-auth.mjs    # Google tokens, sessions, sign-in-gated checkout, ownership
```

## Deploy

See `STEP3_SETUP.md` for Cloudflare variables, KV/D1 bindings, the Cashfree
webhook and return URLs, the Google OAuth client, and the production checklist.
Non-interactive shells need `CLOUDFLARE_API_TOKEN`.
