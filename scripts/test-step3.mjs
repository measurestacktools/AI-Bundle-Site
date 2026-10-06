// Step 3 logic tests (no network, no secrets). Run: node scripts/test-step3.mjs
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { newOrderId, verifyCashfreeWebhook, hmacSha256Base64 } from "../functions/_lib/crypto.js";
import { isValidEmail, isValidOrderId, PRODUCT } from "../functions/_lib/validate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
const ok = (name, cond) => { assert(cond, `FAIL: ${name}`); pass++; console.log(`ok: ${name}`); };

// 1-3: email validation
ok("valid email", isValidEmail("customer@example.com"));
ok("invalid email rejected", !isValidEmail("not-an-email"));
ok("empty/oversized email rejected", !isValidEmail("") && !isValidEmail("a".repeat(250) + "@x.co"));

// 5-6: server-side price (the ONLY price the backend may charge)
ok("price is 249 INR", PRODUCT.price === 249 && PRODUCT.currency === "INR");
const src = readFileSync(join(root, "functions/api/create-order.js"), "utf8");
ok("create-order ignores browser amount", !/body\.amount|amount.*req|req.*amount/i.test(src.replace(/order_amount/g, "")));

// order id format (Cashfree: 3-45 chars, [A-Za-z0-9_-])
for (let i = 0; i < 50; i++) {
  const id = newOrderId();
  if (!/^[A-Za-z0-9_-]{3,45}$/.test(id)) throw new Error("FAIL: order id format: " + id);
}
ok("order ids unique + cashfree-compatible", new Set(Array.from({ length: 50 }, newOrderId)).size === 50);
ok("order id validator", isValidOrderId(newOrderId()) && !isValidOrderId("../etc") && !isValidOrderId(""));

// 13-14: webhook HMAC roundtrip (13 valid, 14 tampered/invalid)
{
  const secret = "test_secret_key_123";
  const ts = String(Date.now());
  const raw = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "aib_test" } } });
  const sig = await hmacSha256Base64(secret, ts + raw);
  ok("valid webhook verifies", await verifyCashfreeWebhook({ signature: sig, timestamp: ts, rawBody: raw, secret }));
  ok("tampered body rejected", !(await verifyCashfreeWebhook({ signature: sig, timestamp: ts, rawBody: raw + "x", secret })));
  ok("wrong secret rejected", !(await verifyCashfreeWebhook({ signature: sig, timestamp: ts, rawBody: raw, secret: "nope" })));
  ok("missing headers rejected", !(await verifyCashfreeWebhook({ signature: "", timestamp: ts, rawBody: raw, secret })));
}

// 29-30: no secrets in repo (frontend, docs, functions)
{
  const pat = /gsk_[A-Za-z0-9]{5,}|cfat_[A-Za-z0-9]+|sk-ant-[A-Za-z0-9-]+|rzp_(live|test)_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|(SECRET|TOKEN|PASSWORD)["']?\s*[:=]\s*["']?(?![Ee]nv\.)[A-Za-z0-9._~-]{12,}/i;
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return [".git", ".playwright-mcp", "node_modules"].includes(e.name) ? [] : walk(p);
    return /\.(html|js|css|json|md|toml|sql|mjs)$/.test(e.name) && e.name !== "test-step3.mjs" ? [p] : [];
  });
  const bad = walk(root).filter((f) => pat.test(readFileSync(f, "utf8")));
  ok("no secrets committed", bad.length === 0);
}

// 15,18: gating logic present (unpaid -> 403, dedupe ledger present)
{
  const dl = readFileSync(join(root, "functions/api/create-download.js"), "utf8");
  ok("unpaid download -> 403", /status !== "PAID"[\s\S]{0,200}403/.test(dl));
  const wh = readFileSync(join(root, "functions/api/cashfree/webhook.js"), "utf8");
  ok("webhook idempotent", /claimEvent/.test(wh) && /releaseEvent/.test(wh) && /deduped/.test(wh));
  ok("webhook verifies before trust", wh.indexOf("verifyCashfreeWebhook") < wh.indexOf("setStatus"));
}

console.log(`\nALL ${pass} LOGIC TESTS PASSED`);
