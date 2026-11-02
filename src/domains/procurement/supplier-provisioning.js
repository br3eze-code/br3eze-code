/**
 * Provider-neutral supplier provisioning lifecycle.
 *
 * Persistence adapters MUST implement the atomic methods documented below;
 * this service intentionally does not pretend an in-memory mock is durable.
 * External supplier calls are made only after approval and an idempotent local
 * order claim. The supplier adapter should also honor the same idempotency key.
 */
const TERMINAL_PAYMENT_STATES = new Set(['paid', 'settled', 'refunded', 'failed']);
const TERMINAL_ORDER_STATES = new Set(['closed', 'cancelled']);

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

function positiveQuantity(value, name = 'quantity') {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new TypeError(`${name} must be a positive integer`);
  return quantity;
}

function assertScope(scope = {}) {
  return {
    tenantId: requiredString(scope.tenantId, 'tenantId'),
    userId: requiredString(scope.userId, 'userId'),
    projectId: requiredString(scope.projectId, 'projectId'),
  };
}

function assertApproval(approval, { tenantId, projectId, action }) {
  if (!approval || approval.status !== 'APPROVED' || !approval.approvalId) {
    const error = new Error(`Approved ${action} authorization is required`);
    error.code = 'SUPPLIER_APPROVAL_REQUIRED';
    throw error;
  }
  if (approval.tenantId !== tenantId || approval.projectId !== projectId || approval.action !== action) {
    const error = new Error('Approval scope or action does not match the requested operation');
    error.code = 'SUPPLIER_APPROVAL_SCOPE_MISMATCH';
    throw error;
  }
}

function requiredSupplierReferenceUrl(value) {
  let url;
  try { url = new URL(requiredString(value, 'supplierReferenceUrl')); } catch {
    throw new TypeError('supplierReferenceUrl must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError('supplierReferenceUrl must be an HTTPS URL without embedded credentials');
  }
  return url.toString();
}

function normalizeLines(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) throw new TypeError('At least one order line is required');
  return lines.map((line, index) => ({
    productId: requiredString(line?.productId, `lines[${index}].productId`),
    quantity: positiveQuantity(line?.quantity, `lines[${index}].quantity`),
    unitPrice: Number(line?.unitPrice),
    currency: requiredString(line?.currency, `lines[${index}].currency`).toUpperCase(),
    supplierSku: typeof line?.supplierSku === 'string' ? line.supplierSku.trim() : null,
    supplierReferenceUrl: line?.supplierReferenceUrl == null ? null : requiredSupplierReferenceUrl(line.supplierReferenceUrl),
  })).map((line) => {
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) throw new TypeError('unitPrice must be a non-negative finite number');
    return { ...line, receivedQuantity: 0, rejectedQuantity: 0 };
  }).map((line, index, all) => {
    if (all.findIndex((item) => item.productId === line.productId) !== index) throw new TypeError('Duplicate productId lines are not allowed in one purchase order');
    return line;
  });
}

function sameMoney(a, b) {
  return String(a.currency).toUpperCase() === String(b.currency).toUpperCase()
    && Math.abs(Number(a.amount) - Number(b.amount)) <= 0.000001;
}

export class SupplierProvisioningService {
  constructor({ store, supplierAdapter, clock = () => new Date().toISOString() } = {}) {
    if (!store) throw new TypeError('A durable supplier provisioning store is required');
    if (!supplierAdapter || typeof supplierAdapter.createPurchaseOrder !== 'function') {
      throw new TypeError('Supplier adapter must implement createPurchaseOrder');
    }
    const requiredStoreMethods = [
      'getSupplier', 'createOrderIfAbsent', 'getOrder', 'updateOrder',
      'appendEventIfAbsent', 'applyReceiptAtomically', 'listOpenOrders',
      'freezeSupplier', 'matchInvoiceAtomically',
    ];
    const missing = requiredStoreMethods.filter((method) => typeof store[method] !== 'function');
    if (missing.length) throw new TypeError(`Supplier store missing atomic contract: ${missing.join(', ')}`);
    this.store = store;
    this.supplierAdapter = supplierAdapter;
    this.clock = clock;
  }

  async createPurchaseOrder({ request, scope: rawScope, approval, idempotencyKey }) {
    const scope = assertScope(rawScope);
    const key = requiredString(idempotencyKey, 'idempotencyKey');
    const supplierId = requiredString(request?.supplierId, 'supplierId');
    assertApproval(approval, { ...scope, action: 'purchase.order' });
    if (request.alternativeForSupplierId) {
      assertApproval(approval.alternativeApproval, { ...scope, action: 'supplier.alternative' });
    }

    const supplier = await this.store.getSupplier(supplierId, scope.tenantId);
    if (!supplier || supplier.tenantId !== scope.tenantId) throw new Error('Supplier not found in tenant scope');
    if (supplier.status !== 'active') {
      const error = new Error('Supplier is not active; new commitments are blocked');
      error.code = 'SUPPLIER_NOT_ACTIVE';
      throw error;
    }

    const lines = normalizeLines(request.lines);
    const record = {
      orderId: requiredString(request.orderId, 'orderId'),
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      requestedBy: scope.userId,
      supplierId,
      idempotencyKey: key,
      status: 'submitting',
      paymentStatus: 'unpaid',
      currency: lines[0].currency,
      lines,
      evidence: [],
      approvalId: approval.approvalId,
      requiredAcceptanceEvidence: Array.isArray(request.requiredAcceptanceEvidence) ? [...request.requiredAcceptanceEvidence] : ['receipt_inspection'],
      createdAt: this.clock(),
      updatedAt: this.clock(),
      nextAction: 'Confirm supplier acknowledgement; recover by idempotency key if the response is uncertain.',
    };
    if (lines.some((line) => line.currency !== record.currency)) throw new Error('Mixed currencies are not allowed in one purchase order');

    // This method must use a unique constraint / transaction on (tenantId, idempotencyKey).
    const claim = await this.store.createOrderIfAbsent(record);
    if (!claim?.order) throw new Error('Store did not return the claimed purchase order');
    if (!claim.created) return { ...claim.order, replay: true };

    await this.store.appendEventIfAbsent({
      eventId: `po-created:${record.orderId}`, tenantId: scope.tenantId,
      orderId: record.orderId, type: 'purchase_order_claimed', createdAt: this.clock(),
    });
    try {
      const external = await this.supplierAdapter.createPurchaseOrder({
        supplierId,
        orderId: record.orderId,
        idempotencyKey: key,
        lines: lines.map(({ productId, quantity, unitPrice, currency, supplierSku, supplierReferenceUrl }) => ({ productId, quantity, unitPrice, currency, supplierSku, supplierReferenceUrl })),
        tenantId: scope.tenantId,
      });
      const next = {
        status: 'ordered',
        supplierOrderId: external?.supplierOrderId || null,
        updatedAt: this.clock(),
        nextAction: 'Track shipment and record inspected receipts.',
      };
      await this.store.updateOrder(record.orderId, scope.tenantId, next);
      await this.store.appendEventIfAbsent({
        eventId: `po-submitted:${record.orderId}`, tenantId: scope.tenantId,
        orderId: record.orderId, type: 'purchase_order_submitted', createdAt: this.clock(),
      });
      return { ...record, ...next };
    } catch (error) {
      // Keep the idempotency claim. Never blindly re-create an external order
      // after a timeout: reconcile by idempotency key with the supplier first.
      const next = {
        status: 'submission_unknown',
        updatedAt: this.clock(),
        nextAction: 'Reconcile supplier state by idempotency key before retrying; do not create a replacement order.',
        submissionError: String(error?.message || error),
      };
      await this.store.updateOrder(record.orderId, scope.tenantId, next);
      throw Object.assign(new Error('Supplier submission outcome is uncertain; order claim retained for recovery'), {
        code: 'SUPPLIER_SUBMISSION_UNKNOWN',
        cause: error,
        orderId: record.orderId,
      });
    }
  }

  async receivePartial({ orderId, scope: rawScope, receiptId, lines, evidence = [] }) {
    const scope = assertScope(rawScope);
    const key = requiredString(receiptId, 'receiptId');
    if (!Array.isArray(evidence) || evidence.length === 0 || evidence.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new Error('Receipt inspection evidence is required');
    }
    const order = await this.store.getOrder(requiredString(orderId, 'orderId'), scope.tenantId);
    if (!order || order.tenantId !== scope.tenantId || order.projectId !== scope.projectId) throw new Error('Purchase order not found in tenant/project scope');
    if (TERMINAL_ORDER_STATES.has(order.status)) throw new Error('Cannot receive against a terminal purchase order');
    if (!Array.isArray(lines) || !lines.length) throw new TypeError('Receipt lines are required');

    const received = lines.map((line) => {
      const acceptedQuantity = Number(line?.acceptedQuantity ?? 0);
      const rejectedQuantity = Number(line?.rejectedQuantity ?? 0);
      if (!Number.isSafeInteger(acceptedQuantity) || acceptedQuantity < 0) {
        throw new TypeError('acceptedQuantity must be a non-negative integer');
      }
      if (!Number.isSafeInteger(rejectedQuantity) || rejectedQuantity < 0) {
        throw new TypeError('rejectedQuantity must be a non-negative integer');
      }
      if (acceptedQuantity + rejectedQuantity <= 0) {
        throw new TypeError('A receipt line must accept or reject at least one unit');
      }
      return {
        productId: requiredString(line?.productId, 'receipt productId'),
        acceptedQuantity,
        rejectedQuantity,
      };
    });
    if (new Set(received.map((line) => line.productId)).size !== received.length) {
      throw new TypeError('Duplicate productId receipt lines are not allowed');
    }
    const result = await this.store.applyReceiptAtomically({
      order,
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      receiptId: key,
      lines: received,
      evidence: [...evidence],
      receivedAt: this.clock(),
    });
    if (!result?.order) throw new Error('Store must atomically persist receipt, inventory increments, and idempotency claim');
    return result;
  }

  async matchInvoice({ orderId, scope: rawScope, invoice, approval }) {
    const scope = assertScope(rawScope);
    const order = await this.store.getOrder(requiredString(orderId, 'orderId'), scope.tenantId);
    if (!order || order.tenantId !== scope.tenantId || order.projectId !== scope.projectId) throw new Error('Purchase order not found in tenant/project scope');
    const orderTotal = order.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const receiptComplete = order.lines.every((line) => Number(line.receivedQuantity || 0) === Number(line.quantity));
    const quantityMatches = Array.isArray(invoice?.lines) && invoice.lines.length === order.lines.length
      && order.lines.every((line) => invoice.lines.some((item) => item.productId === line.productId && Number(item.quantity) === line.quantity));
    const amountMatches = sameMoney({ amount: orderTotal, currency: order.currency }, { amount: invoice?.amount, currency: invoice?.currency });
    if (!receiptComplete || !quantityMatches || !amountMatches) {
      await this.store.updateOrder(order.orderId, scope.tenantId, {
        invoiceStatus: 'disputed',
        status: order.status === 'closed' ? 'closed' : 'invoice_disputed',
        updatedAt: this.clock(),
        nextAction: 'Resolve purchase-order, receipt, and invoice discrepancy before settlement.',
      });
      return { matched: false, settlementAllowed: false, reason: 'three_way_match_failed' };
    }
    assertApproval(approval, { ...scope, action: 'settlement.release' });
    return this.store.matchInvoiceAtomically({
      order,
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      invoice: { ...invoice },
      approvalId: approval.approvalId,
      matchedAt: this.clock(),
    });
  }

  async handleSupplierClosure({ supplierId, scope: rawScope, reason = 'supplier_closed' }) {
    const scope = assertScope(rawScope);
    const id = requiredString(supplierId, 'supplierId');
    await this.store.freezeSupplier(id, scope.tenantId, { status: 'closed', reason, updatedAt: this.clock() });
    const openOrders = await this.store.listOpenOrders({ supplierId: id, tenantId: scope.tenantId });
    return {
      supplierId: id,
      frozen: true,
      openOrders: openOrders.map((order) => ({
        orderId: order.orderId,
        status: order.status,
        outstandingQuantities: order.lines.map((line) => ({
          productId: line.productId,
          quantity: Math.max(0, line.quantity - Number(line.receivedQuantity || 0) - Number(line.rejectedQuantity || 0)),
        })).filter((line) => line.quantity > 0),
        nextAction: 'Reconcile deposits, shipment state, and customer commitments; obtain separate approval before supplier substitution.',
      })),
    };
  }

  async applySupplierEvent({ orderId, scope: rawScope, eventId, type, paymentStatus, shipmentStatus }) {
    const scope = assertScope(rawScope);
    const id = requiredString(orderId, 'orderId');
    const eventKey = requiredString(eventId, 'eventId');
    const order = await this.store.getOrder(id, scope.tenantId);
    if (!order || order.tenantId !== scope.tenantId || order.projectId !== scope.projectId) throw new Error('Purchase order not found in tenant/project scope');
    const claim = await this.store.appendEventIfAbsent({
      eventId: eventKey, tenantId: scope.tenantId, orderId: id, type, createdAt: this.clock(),
    });
    if (claim?.created === false) return { replay: true, order };
    const patch = { updatedAt: this.clock() };
    if (paymentStatus) {
      const current = order.paymentStatus || 'unpaid';
      if (TERMINAL_PAYMENT_STATES.has(current) && paymentStatus !== current) {
        return { ignored: true, reason: 'terminal_payment_state', order };
      }
      patch.paymentStatus = paymentStatus;
    }
    if (shipmentStatus && !TERMINAL_ORDER_STATES.has(order.status)) patch.shipmentStatus = shipmentStatus;
    const updated = await this.store.updateOrder(id, scope.tenantId, patch);
    return { replay: false, order: updated || { ...order, ...patch } };
  }

  async recover({ orderId, scope: rawScope }) {
    const scope = assertScope(rawScope);
    const order = await this.store.getOrder(requiredString(orderId, 'orderId'), scope.tenantId);
    if (!order || order.tenantId !== scope.tenantId || order.projectId !== scope.projectId) throw new Error('Purchase order not found in tenant/project scope');
    return {
      order,
      evidence: [...(order.evidence || [])],
      nextAction: order.nextAction || 'Inspect transaction evidence and assign a recovery action.',
    };
  }

  async closeOrder({ orderId, scope: rawScope, acceptanceEvidence = [] }) {
    const scope = assertScope(rawScope);
    const order = await this.store.getOrder(requiredString(orderId, 'orderId'), scope.tenantId);
    if (!order || order.tenantId !== scope.tenantId || order.projectId !== scope.projectId) throw new Error('Purchase order not found in tenant/project scope');
    const supplied = new Set(acceptanceEvidence.filter((item) => typeof item === 'string' && item.trim()));
    const persistedEvidence = new Set(order.evidence || []);
    const unverified = [...supplied].filter((item) => !persistedEvidence.has(item));
    if (unverified.length) return { closed: false, reason: 'acceptance_evidence_unverified', unverified };
    const missing = (order.requiredAcceptanceEvidence || ['receipt_inspection']).filter((item) => !supplied.has(item));
    if (missing.length) return { closed: false, reason: 'acceptance_evidence_missing', missing };
    if (!['received', 'invoice_matched', 'settled'].includes(order.status) && order.status !== 'ordered') {
      return { closed: false, reason: 'order_not_ready_for_closure' };
    }
    if (!order.lines.every((line) => Number(line.receivedQuantity || 0) === Number(line.quantity))) {
      return { closed: false, reason: 'quantities_outstanding' };
    }
    const next = await this.store.updateOrder(order.orderId, scope.tenantId, {
      status: 'closed',
      evidence: [...new Set([...(order.evidence || []), ...supplied])],
      updatedAt: this.clock(),
      nextAction: null,
    });
    return { closed: true, order: next || { ...order, status: 'closed', evidence: [...supplied] } };
  }
}

export { assertApproval, assertScope, normalizeLines };
