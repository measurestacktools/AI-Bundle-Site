// Purchase-access tests (mock D1, stubbed Resend, no network, no secrets).
// Run: node scripts/test-access.mjs
import assert from "node:assert";
import { onRequestPost as requestCode } from "../functions/api/request-access-code.js";
import { onRequestPost as verifyCode } from "../functions/api/verify-access-code.js";
import { onRequestPost as mintToken } from "../functions/api/create-download-token.js";
import { redeemDownloadToken } from "../functions/_lib/access.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0;
const ok = (name, cond) => { assert(cond, `FAIL: ${name}`); pass++; console.log(`ok: ${name}`); };
const isoIn = (ms) => new Date(Date.now() + ms).toISOString();

// --- stub Resend ------------------------------------------------------------
const sentEmails = [];
globalThis.fetch = async (url, opts) => {
  sentEmails.push({ url, body: JSON.parse(opts.body) });
  return { ok: true };
};

// --- mock D1 -----------------------------------------------------------------
function makeDb(seedOrders) {
  const t = {
    orders: { ...seedOrders },
    access_codes: [],
    access_grants: [],
    download_tokens: [],
    seq: 1,
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
          if (q.includes("FROM orders WHERE id = ?")) return t.orders[args[0]] || null;
          if (q.startsWith("SELECT created_at FROM access_codes"))
            return [...t.access_codes].reverse().find((r) => r.email === args[0]) || null;
          if (q.startsWith("SELECT attempts FROM access_codes")) {
            const r = [...t.access_codes].reverse().find((x) => x.email === args[0] && !x.used);
            return r ? { attempts: r.attempts } : null;
          }
          if (q.startsWith("SELECT email, expires_at FROM access_grants"))
            return t.access_grants.find((x) => x.token_hash === args[0]) || null;
          if (q.startsWith("SELECT order_id, expires_at, used FROM download_tokens"))
            return t.download_tokens.find((x) => x.token_hash === args[0]) || null;
          throw new Error("mock: unhandled first(): " + q);
        },
        async all() {
          if (q.includes("FROM orders WHERE email = ?"))
            return { results: Object.values(t.orders).filter((o) => o.email === args[0] && o.status === "PAID" && o.product_id === args[1]).slice(0, 20) };
          if (q.includes("FROM access_codes WHERE email = ? AND used = 0 AND expires_at > ?"))
            return { results: t.access_codes.filter((r) => r.email === args[0] && !r.used && r.expires_at > args[1]).sort((a, b) => b.id - a.id).slice(0, 5) };
          throw new Error("mock: unhandled all(): " + q);
        },
        async run() {
          if (q.startsWith("DELETE FROM access_codes")) {
            const n0 = t.access_codes.length;
            t.access_codes = t.access_codes.filter((r) => !(r.email === args[0] && (r.used || r.expires_at < args[1])));
            return { meta: { changes: n0 - t.access_codes.length } };
          }
          if (q.startsWith("DELETE FROM access_grants")) {
            t.access_grants = t.access_grants.filter((r) => !(r.email === args[0] && r.expires_at < args[1]));
            return { meta: { changes: 0 } };
          }
          if (q.startsWith("INSERT INTO access_codes")) {
            t.access_codes.push({ id: t.seq++, email: args[0], code_hash: args[1], expires_at: args[2], attempts: 0, used: 0, created_at: args[3] });
            return { meta: { changes: 1 } };
          }
          if (q.startsWith("UPDATE access_codes SET used = 1")) {
            const r = t.access_codes.find((x) => x.id === args[0]);
            if (r) r.used = 1;
            return { meta: { changes: r ? 1 : 0 } };
          }
          if (q.startsWith("UPDATE access_codes SET attempts")) {
            const r = [...t.access_codes].reverse().find((x) => x.email === args[0] && !x.used);
            if (r) r.attempts++;
            return { meta: { changes: r ? 1 : 0 } };
          }
          if (q.startsWith("INSERT INTO access_grants")) {
            t.access_grants.push({ token_hash: args[0], email: args[1], expires_at: args[2], created_at: args[3] });
            return { meta: { changes: 1 } };
          }
          if (q.startsWith("INSERT INTO download_tokens")) {
            t.download_tokens.push({ token_hash: args[0], order_id: args[1], expires_at: args[2], used: 0, created_at: args[3] });
            return { meta: { changes: 1 } };
          }
          if (q.startsWith("UPDATE download_tokens SET used = 1")) {
            const r = t.download_tokens.find((x) => x.token_hash === args[0] && !x.used);
            if (r) { r.used = 1; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          throw new Error("mock: unhandled run(): " + q);
        },
      };
    },
  };
}

const PAID = { id: "aib_paid_for_tests1", email: "buyer@example.com", product_id: "ai-projects-bundle", status: "PAID", paid_at: "2026-10-11T00:00:00.000Z" };
const PENDING = { id: "aib_pend_for_tests2", email: "buyer@example.com", product_id: "ai-projects-bundle", status: "CREATED", paid_at: null };
const OTHER = { id: "aib_paid_someone_else", email: "stranger@example.com", product_id: "ai-projects-bundle", status: "PAID", paid_at: "2026-10-11T00:00:00.000Z" };
const ENV = { RESEND_API_KEY: "re_test", RESEND_FROM: "shop@example.com" };

let ipN = 100;
const ctx = (fn, body, db, env, ip) => fn({
  request: new Request("http://x/api", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip || ("10.7.0." + (++ipN)) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }),
  env: { DB: db, ...(env || ENV) },
}).then(async (r) => [r.status, await r.json()]);
const orderCount = (db) => Object.keys(db.tables.orders).length;

// --- request-code -------------------------------------------------------------
{
  const db = makeDb({ [PAID.id]: PAID });
  const n0 = orderCount(db);
  const [s, d] = await ctx(requestCode, { email: "buyer@example.com" }, db);
  ok("eligible request 200 + generic message", s === 200 && d.ok === true && /eligible purchase exists/.test(d.message));
  ok("code stored hashed (never plaintext)", db.tables.access_codes.length === 1 &&
    /^[0-9a-f]{64}$/.test(db.tables.access_codes[0].code_hash));
  ok("Resend called with code", sentEmails.length === 1 && sentEmails[0].url.includes("api.resend.com") &&
    sentEmails[0].body.to[0] === "buyer@example.com" && /^\d{6}$/.test(sentEmails[0].body.html.match(/(\d{6})/)[1]));
  ok("no new order rows created", orderCount(db) === n0);
}
{
  const db = makeDb({ [PAID.id]: PAID });
  const before = sentEmails.length;
  const [, a] = await ctx(requestCode, { email: "nobody@example.com" }, db);
  const [, b] = await ctx(requestCode, { email: "buyer@example.com" }, db);
  ok("ineligible email gets identical message (no oracle)", JSON.stringify(a) === JSON.stringify(b));
  ok("no email sent when no eligible order", sentEmails.length === before + 1);
  ok("no code stored for ineligible email", db.tables.access_codes.filter((r) => r.email === "nobody@example.com").length === 0);
}
{
  const db = makeDb({ [PAID.id]: PAID });
  const [s] = await ctx(requestCode, { email: "buyer@example.com" }, db, {});
  ok("missing email provider -> honest 503", s === 503);
  const [s2, d2] = await ctx(requestCode, { email: "buyer@example.com" }, db, {});
  ok("honest error names the blocker", s2 === 503 && d2.code === "email_unavailable");
}
{
  const db = makeDb({ [PAID.id]: PAID });
  await ctx(requestCode, { email: "buyer@example.com" }, db);
  const [, d] = await ctx(requestCode, { email: "buyer@example.com" }, db);
  ok("cooldown still says sent, no second code", /eligible purchase exists/.test(d.message) && db.tables.access_codes.length === 1);
}
{
  const db = makeDb({});
  const [s] = await ctx(requestCode, { email: "bad" }, db);
  ok("malformed email -> 400", s === 400);
  let last = 0;
  for (let i = 0; i < 11; i++) {
    const [st] = await ctx(requestCode, { email: "buyer@example.com" }, db, ENV, "10.6.6.6");
    last = st;
  }
  ok("11th request in a minute -> 429", last === 429);
}

// --- verify-code ----------------------------------------------------------------
// helper: request then read the raw code back out of the stubbed email
async function issuedCode(db, email) {
  sentEmails.length = 0;
  await ctx(requestCode, { email }, db);
  return sentEmails[0].body.html.match(/(\d{6})/)[1];
}
{
  const db = makeDb({ [PAID.id]: PAID, [PENDING.id]: PENDING });
  const code = await issuedCode(db, "buyer@example.com");
  const [s, d] = await ctx(verifyCode, { email: "buyer@example.com", code }, db);
  ok("correct code verifies", s === 200 && d.ok === true && typeof d.grant_token === "string");
  ok("only eligible orders listed", d.orders.length === 1 && d.orders[0].order_id === PAID.id && !("email" in d.orders[0]));
  const [s2] = await ctx(verifyCode, { email: "buyer@example.com", code }, db);
  ok("code is single-use (replay rejected)", s2 === 400);
}
{
  const db = makeDb({ [PAID.id]: PAID });
  const code = await issuedCode(db, "buyer@example.com");
  const [, wrong] = await ctx(verifyCode, { email: "buyer@example.com", code: "000000" }, db);
  // expire the real code by hand, then try it
  db.tables.access_codes.forEach((r) => (r.expires_at = isoIn(-1000)));
  const [, expd] = await ctx(verifyCode, { email: "buyer@example.com", code }, db);
  ok("wrong vs expired look identical", JSON.stringify(wrong) === JSON.stringify(expd) && wrong.ok === false);
}
{
  const db = makeDb({ [PAID.id]: PAID });
  const code = await issuedCode(db, "buyer@example.com");
  for (let i = 0; i < 5; i++) await ctx(verifyCode, { email: "buyer@example.com", code: "000000" }, db);
  const [s] = await ctx(verifyCode, { email: "buyer@example.com", code }, db);
  ok("5 wrong attempts lock out even the right code", s === 400);
}

// --- download tokens ---------------------------------------------------------------
{
  const db = makeDb({ [PAID.id]: PAID, [PENDING.id]: PENDING, [OTHER.id]: OTHER });
  const code = await issuedCode(db, "buyer@example.com");
  const [, v] = await ctx(verifyCode, { email: "buyer@example.com", code }, db);
  const gt = v.grant_token;
  const [s, d] = await ctx(mintToken, { grant_token: gt, order_id: PAID.id }, db);
  ok("grant mints token url for own PAID order", s === 200 && d.ok === true && d.url.startsWith("/api/download?token="));
  const dl = decodeURIComponent(d.url.split("token=")[1]);
  const [s2] = await ctx(mintToken, { grant_token: gt, order_id: PENDING.id }, db);
  ok("unpaid order denied", s2 === 403);
  const [s3] = await ctx(mintToken, { grant_token: gt, order_id: OTHER.id }, db);
  ok("someone else's order denied", s3 === 403);
  const [s4] = await ctx(mintToken, { grant_token: "bogus", order_id: PAID.id }, db);
  ok("bad grant denied", s4 === 403);
  // flip order to non-PAID (e.g. refunded): mint must fail
  db.tables.orders[PAID.id].status = "PAYMENT_FAILED";
  const [s5] = await ctx(mintToken, { grant_token: gt, order_id: PAID.id }, db);
  ok("revoked/failed order denied at mint", s5 === 403);
  db.tables.orders[PAID.id].status = "PAID";
  // redeem lifecycle
  ok("redeem ok first time", (await redeemDownloadToken(db, dl)) === PAID.id);
  ok("redeem single-use (second fails)", (await redeemDownloadToken(db, dl)) === null);
  ok("redeem bogus fails", (await redeemDownloadToken(db, "nope")) === null);
  // expired link
  const [ , d2] = await ctx(mintToken, { grant_token: gt, order_id: PAID.id }, db);
  const t2 = decodeURIComponent(d2.url.split("token=")[1]);
  db.tables.download_tokens.forEach((x) => (x.expires_at = isoIn(-1000)));
  ok("expired token rejected", (await redeemDownloadToken(db, t2)) === null);
}

// --- download.js wires the token path ----------------------------------------------
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dl = readFileSync(join(root, "functions/api/download.js"), "utf8");
  ok("download redeems tokens + keeps PAID gate", /redeemDownloadToken/.test(dl) && /status !== "PAID"/.test(dl));
}

console.log(`\n${pass} access tests passed.`);
