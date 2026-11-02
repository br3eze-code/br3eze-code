import { describe, expect, test, jest } from '@jest/globals';
import { SupplierProvisioningService } from '../../src/domains/procurement/supplier-provisioning.js';

function makeHarness(seed = {}) {
  const suppliers = new Map(Object.entries(seed.suppliers || {
    'tenant-a:supplier-a': { supplierId: 'supplier-a', tenantId: 'tenant-a', status: 'active' },
  }));
  const orders = new Map(Object.entries(seed.orders || {}));
  const events = new Map();
  const inventory = new Map();
  const calls = { supplier: [], receipts: [], invoices: [], frozen: [] };
  const store = {
    async getSupplier(id, tenantId) { return suppliers.get(`${tenantId}:${id}`) || null; },
    async createOrderIfAbsent(record) {
      const key = `${record.tenantId}:${record.idempotencyKey}`;
      if (events.has(`idempotency:${key}`)) return { created: false, order: orders.get(events.get(`idempotency:${key}`)) };
      if (orders.has(record.orderId)) return { created: false, order: orders.get(record.orderId) };
      orders.set(record.orderId, structuredClone(record));
      events.set(`idempotency:${key}`, record.orderId);
      return { created: true, order: structuredClone(record) };
    },
    async getOrder(id, tenantId) {
      const order = orders.get(id);
      return order?.tenantId === tenantId ? structuredClone(order) : null;
    },
    async updateOrder(id, tenantId, patch) {
      const order = orders.get(id);
      if (!order || order.tenantId !== tenantId) throw new Error('scoped order not found');
      Object.assign(order, structuredClone(patch));
      return structuredClone(order);
    },
    async appendEventIfAbsent(event) {
      const key = `${event.tenantId}:${event.eventId}`;
      if (events.has(key)) return { created: false };
      events.set(key, true);
      return { created: true };
    },
    async applyReceiptAtomically({ order, tenantId, projectId, receiptId, lines, evidence }) {
      const receiptKey = `receipt:${tenantId}:${receiptId}`;
      if (events.has(receiptKey)) return { replay: true, order: structuredClone(orders.get(order.orderId)) };
      const current = orders.get(order.orderId);
      if (!current || current.tenantId !== tenantId || current.projectId !== projectId) throw new Error('scoped order not found');
      for (const received of lines) {
        const line = current.lines.find((item) => item.productId === received.productId);
        if (!line) throw new Error('unknown product');
        const outstanding = line.quantity - line.receivedQuantity - line.rejectedQuantity;
        if (received.acceptedQuantity + received.rejectedQuantity > outstanding) throw new Error('receipt exceeds outstanding quantity');
        line.receivedQuantity += received.acceptedQuantity;
        line.rejectedQuantity += received.rejectedQuantity;
        inventory.set(`${tenantId}:${received.productId}`, (inventory.get(`${tenantId}:${received.productId}`) || 0) + received.acceptedQuantity);
      }
      current.evidence.push(...evidence);
      current.status = current.lines.every((line) => line.receivedQuantity + line.rejectedQuantity === line.quantity)
        ? 'received' : 'partially_received';
      events.set(receiptKey, true);
      return { replay: false, order: structuredClone(current), inventory: Object.fromEntries(inventory) };
    },
    async listOpenOrders({ supplierId, tenantId }) {
      return [...orders.values()].filter((order) => order.tenantId === tenantId && order.supplierId === supplierId && !['closed', 'cancelled'].includes(order.status)).map((order) => structuredClone(order));
    },
    async freezeSupplier(id, tenantId, patch) {
      const key = `${tenantId}:${id}`;
      const supplier = suppliers.get(key);
      if (!supplier) throw new Error('supplier not found');
      Object.assign(supplier, patch);
      calls.frozen.push({ id, tenantId, ...patch });
    },
    async matchInvoiceAtomically(payload) {
      calls.invoices.push(payload);
      const current = orders.get(payload.order.orderId);
      current.invoiceStatus = 'matched';
      current.status = 'invoice_matched';
      return { matched: true, settlementAllowed: true, order: structuredClone(current) };
    },
  };
  const supplierAdapter = {
    async createPurchaseOrder(input) {
      calls.supplier.push(input);
      return { supplierOrderId: `external-${input.orderId}` };
    },
  };
  const service = new SupplierProvisioningService({ store, supplierAdapter, clock: () => '2026-11-02T00:00:00.000Z' });
  const scope = { tenantId: 'tenant-a', userId: 'user-a', projectId: 'project-a' };
  const approval = { status: 'APPROVED', approvalId: 'approval-1', action: 'purchase.order', tenantId: 'tenant-a', projectId: 'project-a' };
  const request = {
    orderId: 'po-1', supplierId: 'supplier-a',
    lines: [{ productId: 'ap-1', quantity: 10, unitPrice: 12, currency: 'USD', supplierSku: 'SKU-AP1', supplierReferenceUrl: 'https://supplier.example/products/SKU-AP1' }],
    requiredAcceptanceEvidence: ['receipt_inspection', 'customer_acceptance'],
  };
  return { service, store, supplierAdapter, scope, approval, request, orders, suppliers, events, inventory, calls };
}

describe('supplier provisioning transaction guards', () => {
  test('rejects an unapproved purchase order before any external supplier call', async () => {
    const h = makeHarness();
    await expect(h.service.createPurchaseOrder({
      request: h.request, scope: h.scope, idempotencyKey: 'request-1',
    })).rejects.toMatchObject({ code: 'SUPPLIER_APPROVAL_REQUIRED' });
    expect(h.calls.supplier).toHaveLength(0);
    expect(h.orders.size).toBe(0);
  });

  test('does not create a second purchase order or call supplier on replay', async () => {
    const h = makeHarness();
    const first = await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    const replay = await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    expect(first.status).toBe('ordered');
    expect(replay).toMatchObject({ orderId: 'po-1', replay: true });
    expect(h.orders.size).toBe(1);
    expect(h.calls.supplier).toHaveLength(1);
    expect(h.calls.supplier[0].lines[0]).toMatchObject({
      supplierSku: 'SKU-AP1',
      supplierReferenceUrl: 'https://supplier.example/products/SKU-AP1',
    });
  });

  test('rejects unsafe supplier reference URLs and duplicate product lines', async () => {
    const h = makeHarness();
    await expect(h.service.createPurchaseOrder({
      request: { ...h.request, lines: [{ ...h.request.lines[0], supplierReferenceUrl: 'http://supplier.example/item' }] },
      scope: h.scope, approval: h.approval, idempotencyKey: 'unsafe-url',
    })).rejects.toThrow(/HTTPS/);
    await expect(h.service.createPurchaseOrder({
      request: { ...h.request, lines: [h.request.lines[0], h.request.lines[0]] },
      scope: h.scope, approval: h.approval, idempotencyKey: 'duplicate-product',
    })).rejects.toThrow(/Duplicate productId/);
    expect(h.calls.supplier).toHaveLength(0);
  });

  test('records partial receipt so six of ten leaves four outstanding', async () => {
    const h = makeHarness();
    await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    const result = await h.service.receivePartial({
      orderId: 'po-1', scope: h.scope, receiptId: 'receipt-1',
      lines: [{ productId: 'ap-1', acceptedQuantity: 6, rejectedQuantity: 0 }],
      evidence: ['inspection-1'],
    });
    expect(result.order.status).toBe('partially_received');
    expect(result.order.lines[0]).toMatchObject({ quantity: 10, receivedQuantity: 6, rejectedQuantity: 0 });
    expect(result.order.lines[0].quantity - result.order.lines[0].receivedQuantity).toBe(4);
  });

  test('only accepted goods increase stock; rejected and unreceived units do not', async () => {
    const h = makeHarness();
    await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    const result = await h.service.receivePartial({
      orderId: 'po-1', scope: h.scope, receiptId: 'receipt-2',
      lines: [{ productId: 'ap-1', acceptedQuantity: 6, rejectedQuantity: 2 }],
      evidence: ['inspection-2'],
    });
    expect(result.inventory['tenant-a:ap-1']).toBe(6);
    expect(result.order.lines[0]).toMatchObject({ receivedQuantity: 6, rejectedQuantity: 2 });
    expect(result.order.lines[0].quantity - result.order.lines[0].receivedQuantity - result.order.lines[0].rejectedQuantity).toBe(2);
  });


  test('reject-only receipt is recorded without adding inventory', async () => {
    const h = makeHarness();
    await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    const result = await h.service.receivePartial({
      orderId: 'po-1', scope: h.scope, receiptId: 'receipt-reject-only',
      lines: [{ productId: 'ap-1', acceptedQuantity: 0, rejectedQuantity: 2 }],
      evidence: ['rejection-report'],
    });
    expect(result.inventory['tenant-a:ap-1'] || 0).toBe(0);
    expect(result.order.lines[0]).toMatchObject({ receivedQuantity: 0, rejectedQuantity: 2 });
  });

  test('replaying a receipt id does not double-credit stock', async () => {
    const h = makeHarness();
    await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    const receipt = {
      orderId: 'po-1', scope: h.scope, receiptId: 'receipt-replay',
      lines: [{ productId: 'ap-1', acceptedQuantity: 3, rejectedQuantity: 0 }],
      evidence: ['inspection-replay'],
    };
    await h.service.receivePartial(receipt);
    const replay = await h.service.receivePartial(receipt);
    expect(replay.replay).toBe(true);
    expect(h.inventory.get('tenant-a:ap-1')).toBe(3);
    expect((await h.store.getOrder('po-1', 'tenant-a')).lines[0].receivedQuantity).toBe(3);
  });

  test('blocks invoice settlement when quantity or price differs', async () => {
    const h = makeHarness();
    await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    await h.service.receivePartial({
      orderId: 'po-1', scope: h.scope, receiptId: 'receipt-3',
      lines: [{ productId: 'ap-1', acceptedQuantity: 10, rejectedQuantity: 0 }], evidence: ['inspection-3'],
    });
    const result = await h.service.matchInvoice({
      orderId: 'po-1', scope: h.scope,
      invoice: { amount: 119, currency: 'USD', lines: [{ productId: 'ap-1', quantity: 10 }] },
      approval: { ...h.approval, action: 'settlement.release' },
    });
    expect(result).toMatchObject({ matched: false, settlementAllowed: false, reason: 'three_way_match_failed' });
    expect(h.calls.invoices).toHaveLength(0);
    expect((await h.store.getOrder('po-1', 'tenant-a')).invoiceStatus).toBe('disputed');
  });

  test('supplier closure freezes new commitments and lists open quantities', async () => {
    const h = makeHarness();
    await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    await h.service.receivePartial({ orderId: 'po-1', scope: h.scope, receiptId: 'receipt-4', lines: [{ productId: 'ap-1', acceptedQuantity: 6, rejectedQuantity: 0 }], evidence: ['inspection-4'] });
    const result = await h.service.handleSupplierClosure({ supplierId: 'supplier-a', scope: h.scope });
    expect(result.frozen).toBe(true);
    expect(result.openOrders[0].outstandingQuantities).toEqual([{ productId: 'ap-1', quantity: 4 }]);
    await expect(h.service.createPurchaseOrder({ request: { ...h.request, orderId: 'po-2' }, scope: h.scope, approval: h.approval, idempotencyKey: 'request-2' }))
      .rejects.toMatchObject({ code: 'SUPPLIER_NOT_ACTIVE' });
    expect(h.calls.supplier).toHaveLength(1);
  });

  test('requires separate approval before using an alternative supplier', async () => {
    const h = makeHarness();
    h.suppliers.set('tenant-a:supplier-b', { supplierId: 'supplier-b', tenantId: 'tenant-a', status: 'active' });
    await expect(h.service.createPurchaseOrder({
      request: { ...h.request, supplierId: 'supplier-b', alternativeForSupplierId: 'supplier-a', orderId: 'po-alt' },
      scope: h.scope, approval: h.approval, idempotencyKey: 'alternative-1',
    })).rejects.toMatchObject({ code: 'SUPPLIER_APPROVAL_REQUIRED' });
    expect(h.calls.supplier).toHaveLength(0);
  });

  test('duplicate supplier events do not replay mutations or regress settled payment', async () => {
    const h = makeHarness();
    await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    await h.store.updateOrder('po-1', 'tenant-a', { paymentStatus: 'settled', status: 'settled' });
    const event = { orderId: 'po-1', scope: h.scope, eventId: 'event-1', type: 'shipment_delayed', paymentStatus: 'failed', shipmentStatus: 'delayed' };
    const first = await h.service.applySupplierEvent(event);
    const duplicate = await h.service.applySupplierEvent(event);
    expect(first).toMatchObject({ ignored: true, reason: 'terminal_payment_state' });
    expect(duplicate).toMatchObject({ replay: true });
    expect((await h.store.getOrder('po-1', 'tenant-a')).paymentStatus).toBe('settled');
  });

  test('recovers persisted evidence and next action after service reconstruction', async () => {
    const h = makeHarness();
    await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    await h.service.receivePartial({ orderId: 'po-1', scope: h.scope, receiptId: 'receipt-5', lines: [{ productId: 'ap-1', acceptedQuantity: 6, rejectedQuantity: 0 }], evidence: ['inspection-recovery'] });
    const restarted = new SupplierProvisioningService({ store: h.store, supplierAdapter: h.supplierAdapter, clock: () => '2026-11-02T00:00:00.000Z' });
    const recovered = await restarted.recover({ orderId: 'po-1', scope: h.scope });
    expect(recovered.evidence).toContain('inspection-recovery');
    expect(recovered.nextAction).toBeTruthy();
    expect(recovered.order.lines[0].receivedQuantity).toBe(6);
  });

  test('prevents cross-tenant access to supplier transactions', async () => {
    const h = makeHarness();
    await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    await expect(h.service.recover({
      orderId: 'po-1', scope: { tenantId: 'tenant-b', userId: 'user-b', projectId: 'project-b' },
    })).rejects.toThrow(/not found in tenant\/project scope/);
    await expect(h.service.receivePartial({
      orderId: 'po-1', scope: { tenantId: 'tenant-b', userId: 'user-b', projectId: 'project-b' },
      receiptId: 'cross-tenant-receipt', lines: [{ productId: 'ap-1', acceptedQuantity: 1 }], evidence: ['x'],
    })).rejects.toThrow(/not found in tenant\/project scope/);
  });

  test('does not close an order until required acceptance evidence is present', async () => {
    const h = makeHarness();
    await h.service.createPurchaseOrder({ request: h.request, scope: h.scope, approval: h.approval, idempotencyKey: 'request-1' });
    await h.service.receivePartial({ orderId: 'po-1', scope: h.scope, receiptId: 'receipt-6', lines: [{ productId: 'ap-1', acceptedQuantity: 10, rejectedQuantity: 0 }], evidence: ['receipt_inspection'] });
    const fabricated = await h.service.closeOrder({ orderId: 'po-1', scope: h.scope, acceptanceEvidence: ['receipt_inspection', 'customer_acceptance'] });
    expect(fabricated).toMatchObject({ closed: false, reason: 'acceptance_evidence_unverified', unverified: ['customer_acceptance'] });
    const blocked = await h.service.closeOrder({ orderId: 'po-1', scope: h.scope, acceptanceEvidence: ['receipt_inspection'] });
    expect(blocked).toMatchObject({ closed: false, reason: 'acceptance_evidence_missing', missing: ['customer_acceptance'] });
    const order = await h.store.getOrder('po-1', 'tenant-a');
    await h.store.updateOrder('po-1', 'tenant-a', { evidence: [...order.evidence, 'customer_acceptance'] });
    const closed = await h.service.closeOrder({ orderId: 'po-1', scope: h.scope, acceptanceEvidence: ['receipt_inspection', 'customer_acceptance'] });
    expect(closed.closed).toBe(true);
    expect(closed.order.status).toBe('closed');
  });
});
