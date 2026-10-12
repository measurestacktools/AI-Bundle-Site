// Order-lookup endpoint tests (mock D1, no network, no secrets).
// Run: node scripts/test-lookup.mjs
import assert from "node:assert";
import {
  onRequestPost,
  mapLookupState,
  normalizeLookupEmail,
} from "../functions/api/order-lookup.js";

let pass = 0;
const ok = (name, cond) => { assert(cond, `FAIL: ${name}`); pass++; console.log(`ok: ${name}`); };

// --- pure mapper -----------------------------------------------------------
ok("PAID maps PAID", mapLookupState("PAID") === "PAID");
ok("CREATED maps PENDING", mapLookupState("CREATED") === "PAYMENT_PENDING");
ok("null maps PENDING", mapLookupState(null) === "PAYMENT_PENDING");
ok("PAYMENT_FAILED maps FAILED", mapLookupState("PAYMENT_FAILED") === "PAYMENT_FAILED");
ok("CANCELLED maps FAILED", mapLookupState("CANCELLED") === "PAYMENT_FAILED");
ok("email normalized", normalizeLookupEmail("  YOU@Example.COM ") === "you@example.com");

// --- mock D1 ---------------------------------------------------------------
function mockDb(rows) {
  return {
    prepare(sql) {
      return {
        _id: null,
        bind(id) { this._id = id; return this; },
        async first() {
          if (!/FROM orders WHERE id = \?/.test(sql)) throw new Error("unexpected query: " + sql);
          return rows[this._id] || null;
        },
      };
    },
  };
}
const PAID_ROW = {
  id: "aib_testpaid_abc123", email: "buyer@example.com",
  product_id: "ai-projects-bundle", status: "PAID",
};
const PENDING_ROW = {
  id: "aib_testpend_xyz789", email: "waiter@example.com",
  product_id: "ai-projects-bundle", status: "CREATED",
};
const FAILED_ROW = {
  id: "aib_testfail_qrs456", email: "buyer@example.com",
  product_id: "ai-projects-bundle", status: "PAYMENT_FAILED",
};
const OTHER_PRODUCT = {
  id: "aib_testother_mm", email: "buyer@example.com",
  product_id: "other-thing", status: "PAID",
};
const DB = mockDb({
  [PAID_ROW.id]: PAID_ROW, [PENDING_ROW.id]: PENDING_ROW,
  [FAILED_ROW.id]: FAILED_ROW, [OTHER_PRODUCT.id]: OTHER_PRODUCT,
});

let ipN = 0;
function req(body, ip) {
  return new Request("http://x/api/order-lookup", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip || ("10.9.0." + (++ipN)) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const post = (body, ip) => onRequestPost({ request: req(body, ip), env: { DB } }).then(async (r) => [r.status, await r.json()]);

// --- behavior --------------------------------------------------------------
{
  const [s, d] = await post({ order_id: PAID_ROW.id, email: "buyer@example.com" });
  ok("valid PAID lookup 200", s === 200 && d.ok === true && d.state === "PAID");
  ok("PAID includes product + purchase url, no PII", d.product === "ai-projects-bundle" &&
    d.purchase_url === "/success.html?oid=" + PAID_ROW.id && !("email" in d) && !JSON.stringify(d).includes("buyer@"));
}
{
  const [s, d] = await post({ order_id: PAID_ROW.id, email: "  BUYER@EXAMPLE.COM " });
  ok("email match is case/space-insensitive", s === 200 && d.state === "PAID");
}
{
  const [s, d] = await post({ order_id: PENDING_ROW.id, email: "waiter@example.com" });
  ok("pending order maps PENDING, no url", s === 200 && d.state === "PAYMENT_PENDING" && !("purchase_url" in d));
}
{
  const [s, d] = await post({ order_id: FAILED_ROW.id, email: "buyer@example.com" });
  ok("failed order maps FAILED", s === 200 && d.state === "PAYMENT_FAILED");
}
// no-oracle: mismatch / unknown / bad input all look identical
{
  const [, a] = await post({ order_id: PAID_ROW.id, email: "stranger@example.com" });
  const [, b] = await post({ order_id: "aib_no_such_order_1", email: "buyer@example.com" });
  const [, c] = await post({ order_id: "short", email: "buyer@example.com" });
  const [, d2] = await post({ order_id: PAID_ROW.id, email: "not-an-email" });
  const [, e] = await post({ order_id: OTHER_PRODUCT.id, email: "buyer@example.com" });
  for (const [n, d] of [["mismatch", a], ["unknown", b], ["bad-id", c], ["bad-email", d2], ["other-product", e]]) {
    ok(`no oracle: ${n} is UNKNOWN`, d.ok === true && d.state === "UNKNOWN" && Object.keys(d).length === 2);
  }
  ok("mismatch identical to unknown", JSON.stringify(a) === JSON.stringify(b));
}
{
  const r = await onRequestPost({ request: req({}), env: {} });
  ok("no DB -> 503", r.status === 503);
}
{
  const r = await onRequestPost({ request: req("not json{{{", "10.9.9.9"), env: { DB } });
  ok("malformed JSON -> 400", r.status === 400);
}
// rate limiting: 20/min per IP on the lookup endpoint
{
  const ip = "10.8.8.8";
  let last = 0;
  for (let i = 0; i < 22; i++) {
    const r = await onRequestPost({ request: req({ order_id: PAID_ROW.id, email: "buyer@example.com" }, ip), env: { DB } });
    last = r.status;
  }
  ok("21st+ lookup in a minute -> 429", last === 429);
}

console.log(`\n${pass} lookup tests passed.`);
