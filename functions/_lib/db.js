// D1 order/event persistence. Binding: env.DB
export const nowIso = () => new Date().toISOString();

export async function createOrderRow(db, row) {
  await db
    .prepare(
      `INSERT INTO orders (id, cashfree_order_id, email, product_id, amount, currency, status, created_at, fulfillment_status, email_status)
       VALUES (?, ?, ?, ?, ?, ?, 'CREATED', ?, 'NONE', 'PENDING')`
    )
    .bind(row.id, row.cashfreeOrderId, row.email, row.productId, row.amount, row.currency, nowIso())
    .run();
}

export async function getOrderById(db, id) {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(id).first();
}

export async function getOrderByCfId(db, cfOrderId) {
  return db.prepare(`SELECT * FROM orders WHERE cashfree_order_id = ?`).bind(cfOrderId).first();
}

export async function setStatus(db, id, status, extra = {}) {
  const sets = [`status = ?`];
  const vals = [status];
  if (extra.paidAt) {
    sets.push(`paid_at = ?`);
    vals.push(extra.paidAt);
  }
  if (extra.cfPaymentId) {
    sets.push(`cf_payment_id = ?`);
    vals.push(extra.cfPaymentId);
  }
  if (extra.paymentReference) {
    sets.push(`payment_reference = ?`);
    vals.push(extra.paymentReference);
  }
  if (extra.fulfillment) {
    sets.push(`fulfillment_status = ?`);
    vals.push(extra.fulfillment);
  }
  if (extra.emailStatus) {
    sets.push(`email_status = ?`);
    vals.push(extra.emailStatus);
  }
  vals.push(id);
  await db.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
}

export async function recordDownload(db, id) {
  await db
    .prepare(`UPDATE orders SET download_count = download_count + 1, last_download_at = ? WHERE id = ?`)
    .bind(nowIso(), id)
    .run();
}

// Idempotency ledger. claimEvent atomically inserts; returns true if this
// caller owns the event. Release MUST be called when processing did not reach
// a terminal outcome, otherwise retries are poisoned (deduped forever).
export async function claimEvent(db, eventKey, { cashfreeOrderId, eventType }) {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO payment_events (event_key, cashfree_order_id, event_type, received_at, processed)
       VALUES (?, ?, ?, ?, 1)`
    )
    .bind(eventKey, cashfreeOrderId, eventType, nowIso())
    .run();
  return (res?.meta?.changes ?? 0) > 0;
}

export async function releaseEvent(db, eventKey) {
  await db.prepare(`DELETE FROM payment_events WHERE event_key = ?`).bind(eventKey).run();
}

// Back-compat single call (kept for tests/readers): claim without release.
export async function alreadyProcessed(db, eventKey, meta) {
  return !(await claimEvent(db, eventKey, meta));
}
