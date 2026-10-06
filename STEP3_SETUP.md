# STEP 3 — Cashfree + Workers KV + D1 setup (AI Projects Bundle, ₹249)

Funnel: bundle.html Buy Now → email modal → `POST /api/create-order` (₹249, server-side)
→ cashfree.js checkout → return `success.html?oid=` → poll `GET /api/payment-status`
→ webhook verifies + marks PAID → `POST /api/create-download` → same-origin download streamed from Workers KV.

No secrets live in the repo. Everything secret is a Cloudflare dashboard secret/binding.

## 1. Cashfree merchant account (legitimate onboarding)

1. Sign up at https://merchant.cashfree.com (business + KYC as Cashfree requires).
2. In test mode, open Developers → API keys → copy **App ID** and **Secret Key** (sandbox).
3. Only after the full sandbox funnel passes, repeat with production keys.

## 2. Cloudflare environment variables (Pages project → Settings → Variables)

Plain variables:

| Name | Value |
|---|---|
| `CASHFREE_ENVIRONMENT` | `sandbox` (use `production` only after sandbox passes) |
| `SITE_URL` | `https://aiprojectsbundle.pages.dev` |
| `RESEND_FROM` | sender, e.g. `AI Bundle <orders@yourdomain.com>` (only if using email) |

Secrets (Settings → Variables → **Encrypt** / secrets):

| Name | Value |
|---|---|
| `CASHFREE_APP_ID` | `YOUR_CASHFREE_APP_ID` |
| `CASHFREE_SECRET_KEY` | `YOUR_CASHFREE_SECRET_KEY` |
| `RESEND_API_KEY` | `YOUR_EMAIL_API_KEY` (optional; flow works without it) |

Apply to **Production and Preview** (or Production only, your call).

## 3. Workers KV bundle storage (private)

1. Create the namespace: `wrangler kv:namespace create bundle-files`.
   Put the returned namespace ID into your Pages/Workers config (placeholder only — no real IDs in docs).
2. Upload (done by the lead — doc only, do not upload here):
   `wrangler kv:key put ai-projects-bundle-v1.zip --path <zip> --binding BUNDLE_FILES`
   where `<zip>` is the local bundle file path and key `ai-projects-bundle-v1.zip` lives in namespace `bundle-files`.
3. Pages project → Settings → Bindings → Add **KV namespace** binding named `BUNDLE_FILES` pointing at namespace `bundle-files`.
   There is no public URL — the ONLY read path is the Pages Function after the D1 PAID gate.

## 4. D1 database

1. `wrangler d1 create ai-bundle-orders` (or dashboard → D1 → Create).
2. Apply schema: `wrangler d1 execute ai-bundle-orders --remote --file migrations/0001_init.sql`
   (run from the repo root; `--remote` targets Cloudflare, `--local` is local-dev only).
3. Pages project → Settings → Bindings → Add **D1** binding named `DB`.

## 5. Cashfree webhook URL

Set per order automatically via `order_meta.notify_url`, no dashboard config needed:

`https://aiprojectsbundle.pages.dev/api/cashfree/webhook`

(Optionally also configure it in Cashfree dashboard → Webhooks as backup.)

## 6. Return URL

Set per order automatically: `https://aiprojectsbundle.pages.dev/success.html?oid=<internal-order-id>`.
The success page NEVER trusts the URL — it polls `GET /api/payment-status`.

## 7. Email (optional)

Provider: Resend. Set `RESEND_API_KEY` + verified `RESEND_FROM`. Without them,
orders still complete; `email_status` stays `SKIPPED` and the success page says
so honestly. Never fake delivery.

## 8. Local tests

`node scripts/test-step3.mjs` — validates email rules, webhook HMAC roundtrip,
order-id format, amount gating, and scans the repo for secret patterns.

## 9. Deploy

Push to `main` (auto-deploy if Git connected) or
`wrangler pages deploy <dir> --project-name=aiprojectsbundle --branch=main`.

## 10. Sandbox purchase test

1. Open `/bundle.html` → Buy Now → enter email → pay with a Cashfree test instrument.
2. Return lands on `success.html` → status becomes PAID → download works.
3. Check D1 row: status PAID, download_count 1. Confirm no duplicate emails on webhook retry.
4. Confirm download is same-origin from Workers KV, auth re-checked on every request, and unpaid `order_id` gets 403.

## 11. Go production

Only when every sandbox check passes: set `CASHFREE_ENVIRONMENT=production`,
replace App ID/Secret with production keys, re-run one real ₹249 test (refund it
after), then announce.
