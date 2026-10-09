import { getDatabase } from '../../core/database.js';

const SUCCESS_STATUSES = new Set(['succeeded', 'successful', 'completed', 'paid']);
const FAILURE_STATUSES = new Set(['failed', 'cancelled', 'canceled', 'expired']);

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeScope(scope = {}) {
  return {
    tenantId: scope.tenantId || null,
    domain: scope.domain || null,
    siteId: scope.siteId || null,
  };
}

function scopeMatches(record, scope = {}) {
  const requested = normalizeScope(scope);
  return ['tenantId', 'domain', 'siteId'].every((key) => (
    !requested[key] || record[key] === requested[key]
  ));
}

function assertMoney(event, transaction) {
  if (event.amount != null && Math.abs(Number(event.amount) - Number(transaction.amount)) > 0.000001) {
    throw new Error('Payment amount does not match the commerce transaction.');
  }
  if (event.currency && String(event.currency).toUpperCase() !== String(transaction.currency || 'USD').toUpperCase()) {
    throw new Error('Payment currency does not match the commerce transaction.');
  }
}

/**
 * Reconcile a provider event that has already been authenticated by the
 * payment adapter/gateway. This function deliberately does not verify
 * signatures and must never be fed directly from an untrusted HTTP body.
 *
 * The commerce transaction is the source of truth for the order relationship;
 * providerTransactionId is used to locate it so webhook payloads do not need
 * to be trusted for order ownership.
 */
export async function reconcileCommercePayment(event, { db: database = null, scope = {} } = {}) {
  const transactionId = String(event?.transactionId || '').trim();
  const provider = String(event?.provider || '').trim().toLowerCase();
  const status = normalizeStatus(
    event?.status
      || (event?.type === 'payment_success' ? 'succeeded'
        : event?.type === 'payment_failed' ? 'failed' : '')
  );

  if (!transactionId) throw new TypeError('Verified payment transactionId is required.');
  if (!provider) throw new TypeError('Verified payment provider is required.');
  if (!SUCCESS_STATUSES.has(status) && !FAILURE_STATUSES.has(status)) {
    return { reconciled: false, ignored: true, reason: 'unsupported_status', transactionId, provider };
  }

  const dbInstance = database || await getDatabase();
  if (!dbInstance?.db) throw new Error('Commerce payment reconciliation requires the Firebase backend.');
  const fs = dbInstance.db;
  const requestedScope = normalizeScope(scope);

  return fs.runTransaction(async (tx) => {
    const query = fs.collection('transactions')
      .where('providerTransactionId', '==', transactionId)
      .limit(10);
    const matches = await tx.get(query);
    const providerMatches = matches.docs.filter((doc) => (
      String(doc.data()?.paymentMethod || '').toLowerCase() === provider
    ));
    if (!providerMatches.length) throw new Error(`Commerce transaction for provider payment ${transactionId} was not found.`);
    if (providerMatches.length > 1) throw new Error(`Multiple commerce transactions reference provider payment ${transactionId}.`);

    const transactionDoc = providerMatches[0];
    const transaction = transactionDoc.data();
    if (!scopeMatches(transaction, requestedScope)) throw new Error('Payment scope does not match the commerce transaction.');
    assertMoney(event, transaction);

    const orderRef = fs.collection('orders').doc(transaction.orderId);
    const invoiceRef = fs.collection('invoices').doc(transaction.invoiceId);
    const [orderDoc, invoiceDoc] = await Promise.all([tx.get(orderRef), tx.get(invoiceRef)]);
    if (!orderDoc.exists) throw new Error(`Commerce order ${transaction.orderId} was not found.`);
    if (!invoiceDoc.exists) throw new Error(`Commerce invoice ${transaction.invoiceId} was not found.`);

    const successful = SUCCESS_STATUSES.has(status);
    const terminalPaid = transaction.status === 'paid';
    const alreadySettled = terminalPaid && successful && (!transaction.stockReserved || transaction.stockReservationSettled);
    const alreadyFailed = transaction.status === 'failed' && !successful;

    // Never let a late failure webhook roll a completed payment back to failed.
    if (terminalPaid && !successful) {
      return {
        reconciled: false,
        replay: true,
        ignored: true,
        reason: 'payment_already_settled',
        transactionId,
        provider,
        orderId: transaction.orderId,
        invoiceId: transaction.invoiceId,
        status: 'paid',
        orderStatus: 'paid',
      };
    }

    const nextTransactionStatus = successful ? 'paid' : 'failed';
    const nextOrderStatus = successful ? 'paid' : 'payment_failed';
    const nextInvoiceStatus = successful ? 'paid' : 'unpaid';

    // External checkout reserves stock before payment settlement. On a
    // definitive failure, return that reservation atomically. The guard makes
    // repeated failure webhooks harmless and prevents double-restocking.
    if (!successful && !alreadyFailed && transaction.stockReserved && !transaction.stockReservationReleased) {
      const items = Array.isArray(orderDoc.data()?.items) ? orderDoc.data().items : [];
      const quantities = {};
      for (const item of items) {
        const productId = String(item?.productId || '').trim();
        const qty = Number(item?.qty || 0);
        if (productId && Number.isFinite(qty) && qty > 0) quantities[productId] = (quantities[productId] || 0) + qty;
      }
      for (const [productId, qty] of Object.entries(quantities)) {
        const productRef = fs.collection('products').doc(productId);
        const productDoc = await tx.get(productRef);
        if (!productDoc.exists) throw new Error(`Product ${productId} was removed before payment failure reconciliation.`);
        const currentStock = Number(productDoc.data()?.stock || 0);
        tx.update(productRef, { stock: currentStock + qty, salesCount: Math.max(0, Number(productDoc.data()?.salesCount || 0) - qty) });
      }
    }

    if (!alreadySettled && !alreadyFailed) {
      tx.update(transactionDoc.ref, {
        status: nextTransactionStatus,
        providerStatus: status,
        stockReservationSettled: successful && Boolean(transaction.stockReserved),
        stockReservationReleased: !successful && Boolean(transaction.stockReserved),
        reconciledAt: new Date().toISOString(),
        reconciliationEvent: event.eventId || null,
      });
      tx.update(orderRef, {
        status: nextOrderStatus,
        paymentTransactionId: transactionId,
        paymentProvider: provider,
        ...(successful && transaction.stockReserved ? { stockReservationStatus: 'settled' } : {}),
        ...(!successful && transaction.stockReserved ? { stockReservationStatus: 'released' } : {}),
        updatedAt: new Date().toISOString(),
      });
      tx.update(invoiceRef, {
        status: nextInvoiceStatus,
        updatedAt: new Date().toISOString(),
      });
    }

    return {
      reconciled: !alreadySettled && !alreadyFailed,
      replay: alreadySettled || alreadyFailed,
      transactionId,
      provider,
      orderId: transaction.orderId,
      invoiceId: transaction.invoiceId,
      status: nextTransactionStatus,
      orderStatus: nextOrderStatus,
      stockReservationReleased: !successful && Boolean(transaction.stockReserved) && !alreadyFailed,
    };
  });
}

export { SUCCESS_STATUSES, FAILURE_STATUSES, normalizeScope, scopeMatches };
