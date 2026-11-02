import crypto from 'node:crypto';

function docKey(...parts) {
  return crypto.createHash('sha256').update(parts.map((part) => String(part ?? '')).join(':')).digest('hex');
}

function requiredDb(db) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new TypeError('A Firestore-compatible database is required');
  }
  return db;
}

/**
 * Firestore implementation of SupplierProvisioningService's atomic store
 * contract. Orders, idempotency claims, receipt evidence and stock increments
 * are persisted transactionally; all document keys include tenant scope.
 */
export function createFirestoreSupplierStore(database) {
  const db = requiredDb(database);
  const orderRef = (tenantId, orderId) => db.collection('supplierPurchaseOrders').doc(docKey(tenantId, orderId));
  const idempotencyRef = (tenantId, key) => db.collection('supplierProvisioningIdempotency').doc(docKey(tenantId, key));
  const eventRef = (tenantId, eventId) => db.collection('supplierProvisioningEvents').doc(docKey(tenantId, eventId));
  const receiptRef = (tenantId, receiptId) => db.collection('supplierReceipts').doc(docKey(tenantId, receiptId));

  return {
    async getSupplier(supplierId, tenantId) {
      const snap = await db.collection('suppliers').doc(String(supplierId)).get();
      if (!snap.exists) return null;
      const supplier = { supplierId: snap.id, ...snap.data() };
      return supplier.tenantId === tenantId ? supplier : null;
    },

    async createOrderIfAbsent(record) {
      const idempotency = idempotencyRef(record.tenantId, record.idempotencyKey);
      const order = orderRef(record.tenantId, record.orderId);
      return db.runTransaction(async (tx) => {
        const [keySnap, orderSnap] = await Promise.all([tx.get(idempotency), tx.get(order)]);
        if (keySnap.exists) {
          const existingFingerprint = keySnap.data().requestFingerprint;
          if (existingFingerprint && record.requestFingerprint && existingFingerprint !== record.requestFingerprint) {
            const error = new Error('Idempotency key was reused with different supplier order details');
            error.code = 'SUPPLIER_IDEMPOTENCY_CONFLICT';
            error.status = 409;
            throw error;
          }
          const linkedOrderId = keySnap.data().orderId;
          const linked = linkedOrderId === record.orderId ? orderSnap : await tx.get(orderRef(record.tenantId, linkedOrderId));
          if (!linked.exists) throw new Error('Idempotency claim points to a missing supplier order');
          return { created: false, order: { orderId: linked.data().orderId, ...linked.data() } };
        }
        if (orderSnap.exists) {
          const existing = orderSnap.data();
          if (existing.idempotencyKey !== record.idempotencyKey) {
            const error = new Error('Order ID already exists with a different idempotency key');
            error.code = 'SUPPLIER_ORDER_CONFLICT';
            error.status = 409;
            throw error;
          }
          if (existing.requestFingerprint && record.requestFingerprint && existing.requestFingerprint !== record.requestFingerprint) {
            const error = new Error('Order ID was reused with different supplier order details');
            error.code = 'SUPPLIER_IDEMPOTENCY_CONFLICT';
            error.status = 409;
            throw error;
          }
          return { created: false, order: { orderId: existing.orderId, ...existing } };
        }
        tx.create(order, record);
        tx.create(idempotency, { tenantId: record.tenantId, orderId: record.orderId, idempotencyKey: record.idempotencyKey, requestFingerprint: record.requestFingerprint, createdAt: record.createdAt });
        return { created: true, order: { ...record } };
      });
    },

    async getOrder(id, tenantId) {
      const snap = await orderRef(tenantId, id).get();
      if (!snap.exists) return null;
      const record = snap.data();
      return record.tenantId === tenantId ? { ...record } : null;
    },

    async updateOrder(id, tenantId, patch) {
      const ref = orderRef(tenantId, id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().tenantId !== tenantId) throw new Error('Purchase order not found in tenant scope');
        tx.update(ref, { ...patch });
        return { ...snap.data(), ...patch };
      });
    },

    async appendEventIfAbsent(event) {
      const ref = eventRef(event.tenantId, event.eventId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) return { created: false };
        tx.create(ref, event);
        return { created: true };
      });
    },

    async applyReceiptAtomically({ order, tenantId, projectId, receiptId, lines, evidence, receivedAt }) {
      const receipt = receiptRef(tenantId, receiptId);
      const orderDoc = orderRef(tenantId, order.orderId);
      return db.runTransaction(async (tx) => {
        const receiptSnap = await tx.get(receipt);
        const currentSnap = await tx.get(orderDoc);
        if (receiptSnap.exists) {
          if (!currentSnap.exists) throw new Error('Receipt replay references a missing purchase order');
          const priorReceipt = receiptSnap.data();
          if (priorReceipt.orderId !== order.orderId || priorReceipt.projectId !== projectId) {
            const error = new Error('Receipt ID was reused for a different purchase order or project');
            error.code = 'SUPPLIER_RECEIPT_CONFLICT';
            error.status = 409;
            throw error;
          }
          return { replay: true, order: { ...currentSnap.data() } };
        }
        if (!currentSnap.exists) throw new Error('Purchase order not found in tenant scope');
        const current = currentSnap.data();
        if (current.tenantId !== tenantId || current.projectId !== projectId) throw new Error('Purchase order not found in tenant/project scope');

        const productRefs = lines.map((line) => db.collection('products').doc(String(line.productId)));
        const productSnaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));
        const nextLines = (current.lines || []).map((line) => ({ ...line }));
        const updates = [];
        for (let i = 0; i < lines.length; i += 1) {
          const received = lines[i];
          const line = nextLines.find((item) => item.productId === received.productId);
          const productSnap = productSnaps[i];
          if (!line || !productSnap.exists) throw new Error('Receipt product is not part of this order or no longer exists');
          const product = productSnap.data();
          if (product.tenantId !== tenantId) throw new Error('Inventory product is outside the authorized tenant scope');
          const outstanding = Number(line.quantity) - Number(line.receivedQuantity || 0) - Number(line.rejectedQuantity || 0);
          if (received.acceptedQuantity + received.rejectedQuantity > outstanding) throw new Error('Receipt exceeds outstanding quantity');
          line.receivedQuantity = Number(line.receivedQuantity || 0) + received.acceptedQuantity;
          line.rejectedQuantity = Number(line.rejectedQuantity || 0) + received.rejectedQuantity;
          updates.push({ ref: productRefs[i], stock: Number(product.stock || 0) + received.acceptedQuantity });
        }
        const nextStatus = nextLines.every((line) => Number(line.receivedQuantity || 0) + Number(line.rejectedQuantity || 0) === Number(line.quantity))
          ? 'received' : 'partially_received';
        const next = {
          ...current,
          lines: nextLines,
          evidence: [...new Set([...(current.evidence || []), ...evidence])],
          status: nextStatus,
          updatedAt: receivedAt,
          nextAction: nextStatus === 'received' ? 'Match the supplier invoice and verify acceptance evidence.' : 'Receive and inspect remaining quantities.',
        };
        // All reads have completed before writes begin.
        for (const update of updates) tx.update(update.ref, { stock: update.stock, updatedAt: receivedAt });
        tx.create(receipt, { tenantId, projectId, orderId: order.orderId, receiptId, lines, evidence, receivedAt });
        tx.update(orderDoc, next);
        return { replay: false, order: next, inventory: Object.fromEntries(updates.map((update, i) => [lines[i].productId, update.stock])) };
      });
    },

    async listOpenOrders({ supplierId, tenantId }) {
      const snap = await db.collection('supplierPurchaseOrders').where('tenantId', '==', tenantId).get();
      return snap.docs.map((doc) => doc.data())
        .filter((item) => item.supplierId === supplierId && !['closed', 'cancelled'].includes(item.status));
    },

    async freezeSupplier(supplierId, tenantId, patch) {
      const ref = db.collection('suppliers').doc(String(supplierId));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().tenantId !== tenantId) throw new Error('Supplier not found in tenant scope');
        tx.update(ref, patch);
        return { supplierId, ...snap.data(), ...patch };
      });
    },

    async matchInvoiceAtomically({ order, tenantId, projectId, invoice, approvalId, matchedAt }) {
      const ref = orderRef(tenantId, order.orderId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().tenantId !== tenantId || snap.data().projectId !== projectId) throw new Error('Purchase order not found in tenant/project scope');
        const current = snap.data();
        if (current.invoiceStatus === 'matched' || ['settled', 'closed'].includes(current.status)) {
          return { matched: true, settlementAllowed: current.invoiceStatus === 'matched', replay: true, order: current };
        }
        const patch = { invoiceStatus: 'matched', status: 'invoice_matched', invoice: { amount: invoice.amount, currency: invoice.currency, lines: invoice.lines }, invoiceApprovalId: approvalId, updatedAt: matchedAt, nextAction: 'Release settlement only through the approved payment workflow.' };
        tx.update(ref, patch);
        return { matched: true, settlementAllowed: true, order: { ...current, ...patch } };
      });
    },
  };
}
