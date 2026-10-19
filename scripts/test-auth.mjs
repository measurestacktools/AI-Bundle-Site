// Google account/auth tests (real RS256 signatures, mocked JWKS + D1).
// Run: node scripts/test-auth.mjs
import assert from "node:assert";
import { onRequestPost as googleLogin } from "../functions/api/auth/google.js";
import { onRequestPost as logout } from "../functions/api/auth/logout.js";
import { onRequestGet as session } from "../functions/api/auth/session.js";
import { onRequestPost as accountDownload } from "../functions/api/account/download.js";
import { onRequestPost as createOrder } from "../functions/api/create-order.js";
import {
  verifyGoogleIdToken,
  createSession,
  getSessionAccount,
  deleteSession,
} from "../functions/_lib/accounts.js";
import { normalizePhone, isValidPhone } from "../functions/_lib/validate.js";

let pass = 0;
const ok = (name, cond) => { assert(cond, `FAIL: ${name}`); pass++; console.log(`ok: ${name}`); };
const enc = new TextEncoder();
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const isoIn = (ms) => new Date(Date.now() + ms).toISOString();
const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const KID = "testkid1";

// --- RSA signing key (stands in for Google's) --------------------------------
const kp = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"]
);
const pubJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);

async function makeToken(overrides = {}, { badKey = false } = {}) {
  const header = { alg: "RS256", typ: "JWT", kid: KID };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-sub-123",
    email: "buyer@example.com",
    email_verified: true,
    name: "Test Buyer",
    picture: "https://example.com/a.png",
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
  const signingInput = b64u(enc.encode(JSON.stringify(header))) + "." + b64u(enc.encode(JSON.stringify(claims)));
  const key = badKey
    ? (await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true, ["sign", "verify"])).privateKey
    : kp.privateKey;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(signingInput));
  return signingInput + "." + b64u(sig);
}

// --- fetch stub: Google JWKS + Cashfree create-order -------------------------
const realFetch = globalThis.fetch;
const cashfreeCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes("googleapis.com/oauth2/v3/certs")) {
    return {
      ok: true,
      async json() {
        return { keys: [{ ...pubJwk, kid: KID, alg: "RS256", use: "sig" }] };
      },
    };
  }
  if (String(url).includes("cashfree.com/pg/orders")) {
    cashfreeCalls.push(JSON.parse(opts.body || "{}"));
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ order_id: "cf_test_order", cf_order_id: 123456, payment_session_id: "session_test_123" });
      },
    };
  }
  throw new Error("unexpected fetch: " + url);
};

// --- mock D1 -----------------------------------------------------------------
function makeDb(seedOrders = {}) {
  const t = {
    orders: { ...seedOrders },
    accounts: [],
    sessions: [],
    download_tokens: [],
  };
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  return {
    tables: t,
    prepare(sql) {
      const q = norm(sql);
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async first() {
          if (q.startsWith("SELECT id FROM accounts WHERE google_sub = ?"))
            return t.accounts.find((a) => a.google_sub === args[0]) || null;
          if (q.startsWith("SELECT * FROM orders WHERE id = ?")) return t.orders[args[0]] || null;
          if (q.startsWith("SELECT s.account_id")) {
            const s = t.sessions.find((x) => x.token_hash === args[0]);
            if (!s) return null;
            const a = t.accounts.find((x) => x.id === s.account_id);
            if (!a) return null;
            return { account_id: s.account_id, expires_at: s.expires_at, id: a.id, email: a.email, name: a.name, picture: a.picture };
          }
          throw new Error("mock: unhandled first(): " + q);
        },
        async all() {
          if (q.includes("FROM orders WHERE product_id = ? AND (account_id = ? OR email = ?)"))
            return {
              results: Object.values(t.orders).filter(
                (o) => o.product_id === args[0] && ((o.account_id && o.account_id === args[1]) || o.email === args[2])
              ),
            };
          throw new Error("mock: unhandled all(): " + q);
        },
        async run() {
          if (q.startsWith("INSERT INTO accounts")) {
            t.accounts.push({
              id: args[0], google_sub: args[1], email: args[2], name: args[3],
              picture: args[4], created_at: args[5], last_login_at: args[6],
            });
            return { meta: { changes: 1 } };
          }
          if (q.startsWith("UPDATE accounts SET email")) {
            const a = t.accounts.find((x) => x.id === args[4]);
            if (a) Object.assign(a, { email: args[0], name: args[1], picture: args[2], last_login_at: args[3] });
            return { meta: { changes: a ? 1 : 0 } };
          }
          if (q.startsWith("INSERT INTO sessions")) {
            t.sessions.push({ token_hash: args[0], account_id: args[1], expires_at: args[2], created_at: args[3], last_seen_at: args[4] });
            return { meta: { changes: 1 } };
          }
          if (q.startsWith("DELETE FROM sessions")) {
            const n0 = t.sessions.length;
            t.sessions = t.sessions.filter((s) => s.token_hash !== args[0]);
            return { meta: { changes: n0 - t.sessions.length } };
          }
          if (q.startsWith("UPDATE sessions SET last_seen_at")) {
            const s = t.sessions.find((x) => x.token_hash === args[1]);
            if (s) s.last_seen_at = args[0];
            return { meta: { changes: s ? 1 : 0 } };
          }
          if (q.startsWith("INSERT INTO download_tokens")) {
            t.download_tokens.push({ token_hash: args[0], order_id: args[1], expires_at: args[2], used: 0 });
            return { meta: { changes: 1 } };
          }
          if (q.startsWith("INSERT INTO orders")) {
            t.orders[args[0]] = {
              id: args[0], cashfree_order_id: args[1], email: args[2], account_id: args[3],
              product_id: args[4], amount: args[5], currency: args[6], phone: args[7], status: "CREATED",
              created_at: args[8], paid_at: null,
            };
            return { meta: { changes: 1 } };
          }
          throw new Error("mock: unhandled run(): " + q);
        },
      };
    },
  };
}

const PAID = { id: "aib_paid_acct_test", email: "buyer@example.com", product_id: "ai-projects-bundle", status: "PAID", paid_at: "2026-10-11T00:00:00.000Z" };
const PENDING = { id: "aib_pend_acct_test", email: "buyer@example.com", product_id: "ai-projects-bundle", status: "CREATED", paid_at: null };
const OTHER = { id: "aib_other_acct_test", email: "stranger@example.com", product_id: "ai-projects-bundle", status: "PAID", paid_at: "2026-10-11T00:00:00.000Z" };
const ENV = { DB: null, GOOGLE_CLIENT_ID: CLIENT_ID };
const CF_ENV = { CASHFREE_APP_ID: "test_app", CASHFREE_SECRET_KEY: "test_secret", CASHFREE_ENVIRONMENT: "sandbox", SITE_URL: "https://example.test" };

let ipN = 500;
function req(url, { method = "GET", body, cookie, headers = {} } = {}) {
  const h = { "cf-connecting-ip": "10.9.0." + (++ipN), ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h["cookie"] = cookie;
  return new Request(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const call = (fn, url, opts, env) => fn({ request: req(url, opts), env }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})), cookie: r.headers.get("set-cookie") }));

// --- token verification ------------------------------------------------------
{
  ok("valid token verifies", (await verifyGoogleIdToken(await makeToken(), CLIENT_ID))?.email === "buyer@example.com");
  ok("tampered signature rejected", (await verifyGoogleIdToken(await makeToken({}, { badKey: true }), CLIENT_ID)) === null);
  ok("wrong audience rejected", (await verifyGoogleIdToken(await makeToken({ aud: "someone-else" }), CLIENT_ID)) === null);
  ok("expired token rejected", (await verifyGoogleIdToken(await makeToken({ exp: Math.floor(Date.now() / 1000) - 10 }), CLIENT_ID)) === null);
  ok("unverified email rejected", (await verifyGoogleIdToken(await makeToken({ email_verified: false }), CLIENT_ID)) === null);
  ok("wrong issuer rejected", (await verifyGoogleIdToken(await makeToken({ iss: "https://evil.example" }), CLIENT_ID)) === null);
  ok("missing client id rejected", (await verifyGoogleIdToken(await makeToken(), "")) === null);
  ok("garbage token rejected", (await verifyGoogleIdToken("not.a.jwt", CLIENT_ID)) === null);
}

// --- account upsert + sessions ----------------------------------------------
{
  const db = makeDb();
  await upsert(db);
  const a = db.tables.accounts[0];
  ok("first login creates one account", db.tables.accounts.length === 1 && a.email === "buyer@example.com");
  ok("account stores google sub + no secret fields", a.google_sub === "google-sub-123" && !("password" in a));

  const token = await createSession(db, a.id);
  ok("session stores only a hash", /^[0-9a-f]{64}$/.test(db.tables.sessions[0].token_hash) && db.tables.sessions[0].token_hash !== token);
  const acc = await getSessionAccount(db, token);
  ok("valid session resolves account", acc && acc.email === "buyer@example.com");
  ok("bogus session rejected", (await getSessionAccount(db, "bogus")) === null);
  await deleteSession(db, token);
  ok("logout deletes session", (await getSessionAccount(db, token)) === null);

  const t2 = await createSession(db, a.id);
  db.tables.sessions.forEach((s) => (s.expires_at = isoIn(-1000)));
  ok("expired session rejected + pruned", (await getSessionAccount(db, t2)) === null && db.tables.sessions.length === 0);
}
async function upsert(db) {
  const { upsertAccount } = await import("../functions/_lib/accounts.js");
  const claims = { sub: "google-sub-123", email: "buyer@example.com", name: "Test Buyer", picture: "https://example.com/a.png" };
  return upsertAccount(db, claims);
}

// --- /api/auth/google ---------------------------------------------------------
{
  const db = makeDb();
  let r = await call(googleLogin, "https://x/api/auth/google", { method: "POST", body: { credential: await makeToken() } }, { DB: db, GOOGLE_CLIENT_ID: CLIENT_ID });
  ok("login sets HttpOnly Secure SameSite cookie", r.status === 200 && /aib_session=[0-9a-f]{64}/.test(r.cookie) && /HttpOnly/.test(r.cookie) && /Secure/.test(r.cookie) && /SameSite=Lax/.test(r.cookie));
  ok("login response has no token in body", r.body.ok === true && !JSON.stringify(r.body).includes("aib_session"));
  ok("session row created", db.tables.sessions.length === 1);

  r = await call(googleLogin, "https://x/api/auth/google", { method: "POST", body: { credential: "bad" } }, { DB: db, GOOGLE_CLIENT_ID: CLIENT_ID });
  ok("invalid credential -> 401", r.status === 401 && !r.cookie);

  r = await call(googleLogin, "https://x/api/auth/google", { method: "POST", body: { credential: await makeToken() } }, { DB: db, GOOGLE_CLIENT_ID: "" });
  ok("unconfigured Google -> honest 503", r.status === 503 && r.body.code === "google_unavailable");
}

// --- /api/auth/session + account download ------------------------------------
{
  const db = makeDb({ [PAID.id]: PAID, [PENDING.id]: PENDING, [OTHER.id]: OTHER });
  const token = await createSession(db, (await upsert(db)));
  const cookie = "aib_session=" + token;

  let r = await call(session, "https://x/api/auth/session", { cookie }, { DB: db, GOOGLE_CLIENT_ID: CLIENT_ID });
  const ids = r.body.orders.map((o) => o.order_id);
  ok(
    "session lists own orders (paid + pending), never others",
    r.status === 200 &&
      r.body.account.email === "buyer@example.com" &&
      r.body.orders.length === 2 &&
      ids.includes(PAID.id) &&
      ids.includes(PENDING.id) &&
      !ids.includes(OTHER.id)
  );
  ok(
    "orders carry a status for automatic tracking",
    r.body.orders.some((o) => o.status === "PAID") && r.body.orders.some((o) => o.status === "CREATED")
  );

  r = await call(session, "https://x/api/auth/session", {}, { DB: db, GOOGLE_CLIENT_ID: CLIENT_ID });
  ok("signed out returns account null (not 401)", r.status === 200 && r.body.account === null);

  r = await call(accountDownload, "https://x/api/account/download", { method: "POST", body: { order_id: PAID.id } }, { DB: db });
  ok("download without session -> 403", r.status === 403);

  r = await call(accountDownload, "https://x/api/account/download", { method: "POST", body: { order_id: PAID.id }, cookie }, { DB: db });
  ok("own PAID order mints token", r.status === 200 && r.body.url.startsWith("/api/download?token="));

  r = await call(accountDownload, "https://x/api/account/download", { method: "POST", body: { order_id: PENDING.id }, cookie }, { DB: db });
  ok("unpaid order denied", r.status === 403);

  r = await call(accountDownload, "https://x/api/account/download", { method: "POST", body: { order_id: OTHER.id }, cookie }, { DB: db });
  ok("someone else's order denied", r.status === 403);

  r = await call(logout, "https://x/api/auth/logout", { method: "POST", cookie }, { DB: db });
  ok("logout clears cookie + session", r.status === 200 && /Max-Age=0/.test(r.cookie) && db.tables.sessions.length === 0);
}

// --- /api/create-order (sign-in gated) ---------------------------------------
{
  const db = makeDb();
  const accountId = await upsert(db);
  const token = await createSession(db, accountId);
  const cookie = "aib_session=" + token;

  cashfreeCalls.length = 0;
  let r = await call(createOrder, "https://x/api/create-order", { method: "POST" }, { DB: db, ...CF_ENV, GOOGLE_CLIENT_ID: CLIENT_ID });
  ok("create-order without session -> 401", r.status === 401 && cashfreeCalls.length === 0);

  r = await call(createOrder, "https://x/api/create-order", { method: "POST", body: { phone: "9876543210" }, cookie }, { DB: db, ...CF_ENV, GOOGLE_CLIENT_ID: CLIENT_ID });
  ok("signed-in create-order -> payment session", r.status === 200 && r.body.ok === true && r.body.payment_session_id === "session_test_123");

  const sent = cashfreeCalls[0];
  ok("cashfree gets the session email", Boolean(sent) && sent.customer_details.customer_email === "buyer@example.com");
  ok("cashfree gets the customer phone", Boolean(sent) && sent.customer_details.customer_phone === "9876543210");

  r = await call(createOrder, "https://x/api/create-order", { method: "POST", body: { phone: "12345" }, cookie }, { DB: db, ...CF_ENV, GOOGLE_CLIENT_ID: CLIENT_ID });
  ok("invalid phone -> 400 with exact error", r.status === 400 && r.body.ok === false && r.body.error === "Enter a valid 10-digit mobile number" && cashfreeCalls.length === 1);

  r = await call(createOrder, "https://x/api/create-order", { method: "POST", cookie }, { DB: db, ...CF_ENV, GOOGLE_CLIENT_ID: CLIENT_ID });
  ok("missing phone -> 400", r.status === 400 && r.body.error === "Enter a valid 10-digit mobile number" && cashfreeCalls.length === 1);

  const row = Object.values(db.tables.orders)[0];
  ok(
    "order stores account_id + session email + phone",
    Boolean(row) && row.account_id === accountId && row.email === "buyer@example.com" && row.phone === "9876543210" && row.status === "CREATED"
  );
}

// --- one purchase per account: owners cannot start another payment ----------
{
  const db = makeDb();
  const accountId = await upsert(db);
  const token = await createSession(db, accountId);
  const cookie = "aib_session=" + token;
  db.tables.orders["aib_owned_test"] = {
    id: "aib_owned_test", email: "buyer@example.com", account_id: accountId,
    product_id: "ai-projects-bundle", status: "PAID", paid_at: "2026-10-11T00:00:00.000Z",
  };
  cashfreeCalls.length = 0;
  const r = await call(createOrder, "https://x/api/create-order", { method: "POST", body: { phone: "9876543210" }, cookie }, { DB: db, ...CF_ENV, GOOGLE_CLIENT_ID: CLIENT_ID });
  ok(
    "already-owned create-order -> 409 with order_id",
    r.status === 409 && r.body.ok === false && r.body.reason === "already_purchased" && r.body.order_id === "aib_owned_test"
  );
  ok("already-owned does not call cashfree", cashfreeCalls.length === 0);
}

// --- phone normalization -----------------------------------------------------
{
  ok("normalize +91 spaced phone", normalizePhone("+91 98765 43210") === "9876543210" && isValidPhone("+91 98765 43210"));
  ok("normalize leading-zero phone", normalizePhone("09876543210") === "9876543210" && isValidPhone("09876543210"));
  ok("reject phone starting with 1", normalizePhone("1234567890") === "1234567890" && !isValidPhone("1234567890"));
  ok("reject short phone", normalizePhone("98765") === "" && !isValidPhone("98765"));
}

// --- no self-asserted identity ----------------------------------------------
{
  const db = makeDb({ [PAID.id]: PAID });
  const r = await call(googleLogin, "https://x/api/auth/google", { method: "POST", body: { email: "buyer@example.com" } }, { DB: db, GOOGLE_CLIENT_ID: CLIENT_ID });
  ok("email-only payload cannot sign in", r.status === 400 || r.status === 401);
}

globalThis.fetch = realFetch;
console.log(`\n${pass} auth tests passed.`);
