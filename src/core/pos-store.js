import crypto from 'node:crypto';

const key = (...parts) => parts.map((part) => String(part ?? '')).join(':');

export class PosStore {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.sales = new Map();
    this.payments = new Map();
    this.shifts = new Map();
    this.requests = new Map();
  }

  scope(context) {
    return {
      tenantId: context.tenantId,
      siteId: context.siteId,
      terminalId: context.terminalId,
      userId: context.userId,
      shiftId: context.shiftId || null,
    };
  }

  assertScope(record, context) {
    const scope = this.scope(context);
    for (const field of ['tenantId', 'siteId']) {
      if (!scope[field] || record[field] !== scope[field]) throw Object.assign(new Error('POS scope denied'), { status: 403, code: 'POS_SCOPE_DENIED' });
    }
    if (record.terminalId && scope.terminalId && record.terminalId !== scope.terminalId) throw Object.assign(new Error('Terminal scope denied'), { status: 403, code: 'POS_TERMINAL_SCOPE_DENIED' });
    return record;
  }

  openShift(context, openingFloat = 0) {
    const scope = this.scope(context);
    if (!scope.tenantId || !scope.siteId || !scope.terminalId || !scope.userId) throw Object.assign(new Error('Complete POS scope required'), { status: 400, code: 'POS_CONTEXT_REQUIRED' });
    const existing = [...this.shifts.values()].find((shift) => shift.tenantId === scope.tenantId && shift.siteId === scope.siteId && shift.terminalId === scope.terminalId && shift.status === 'open');
    if (existing) return existing;
    const shift = { id: `shift_${crypto.randomUUID()}`, ...scope, openingFloat: Number(openingFloat) || 0, cashIn: 0, cashOut: 0, status: 'open', openedAt: this.now().toISOString(), closedAt: null };
    this.shifts.set(shift.id, shift);
    return shift;
  }

  getShift(context) {
    const shift = [...this.shifts.values()].find((candidate) => candidate.id === context.shiftId && candidate.status === 'open');
    if (!shift) throw Object.assign(new Error('Open cashier shift required'), { status: 409, code: 'POS_SHIFT_REQUIRED' });
    return this.assertScope(shift, context);
  }

  createSale(context, items = [], customer = null) {
    const shift = this.getShift(context);
    const normalizedItems = Array.isArray(items) ? items.map((item) => ({ productRef: String(item.productRef), name: String(item.name || item.productRef), qty: Math.max(1, Number(item.qty) || 1), unitAmount: Number(item.unitAmount) || 0 })).filter((item) => item.productRef) : [];
    if (!normalizedItems.length) throw Object.assign(new Error('At least one sale item is required'), { status: 400, code: 'POS_ITEMS_REQUIRED' });
    const total = normalizedItems.reduce((sum, item) => sum + (item.qty * item.unitAmount), 0);
    const sale = { id: `sale_${crypto.randomUUID()}`, ...this.scope(context), shiftId: shift.id, items: normalizedItems, customer: customer ? { reference: String(customer.reference || '').slice(0, 128), displayName: String(customer.displayName || '').slice(0, 128) } : null, total, currency: 'USD', status: 'draft', createdAt: this.now().toISOString(), paidAt: null, receiptIssuedAt: null };
    this.sales.set(sale.id, sale);
    return sale;
  }

  getSale(id, context) {
    const sale = this.sales.get(id);
    if (!sale) throw Object.assign(new Error('Sale not found'), { status: 404, code: 'POS_SALE_NOT_FOUND' });
    return this.assertScope(sale, context);
  }

  holdSale(id, context) {
    const sale = this.getSale(id, context);
    if (sale.status !== 'draft') throw Object.assign(new Error('Only draft sales can be held'), { status: 409, code: 'POS_INVALID_STATE' });
    sale.status = 'held';
    return sale;
  }

  recallSale(id, context) {
    const sale = this.getSale(id, context);
    if (sale.status !== 'held') throw Object.assign(new Error('Only held sales can be recalled'), { status: 409, code: 'POS_INVALID_STATE' });
    sale.status = 'draft';
    return sale;
  }

  startPayment(id, context, provider, idempotencyKey) {
    const sale = this.getSale(id, context);
    if (!idempotencyKey) throw Object.assign(new Error('Idempotency-Key required'), { status: 400, code: 'IDEMPOTENCY_REQUIRED' });
    const existing = this.payments.get(key(context.tenantId, idempotencyKey));
    if (existing) return existing;
    if (sale.status !== 'draft') throw Object.assign(new Error('Sale is not payable'), { status: 409, code: 'POS_INVALID_STATE' });
    const payment = { id: `pay_${crypto.randomUUID()}`, ...this.scope(context), saleId: sale.id, provider: String(provider || 'manual').toLowerCase(), amount: sale.total, currency: sale.currency, status: 'pending', idempotencyKey, createdAt: this.now().toISOString(), confirmedAt: null };
    this.payments.set(key(context.tenantId, idempotencyKey), payment);
    this.payments.set(payment.id, payment);
    return payment;
  }

  getPayment(id, context) {
    const payment = this.payments.get(id);
    if (!payment) throw Object.assign(new Error('Payment not found'), { status: 404, code: 'POS_PAYMENT_NOT_FOUND' });
    return this.assertScope(payment, context);
  }

  requestCorrection(type, id, context, reason) {
    const sale = this.getSale(id, context);
    const request = { id: `posreq_${crypto.randomUUID()}`, ...this.scope(context), saleId: sale.id, type, reason: String(reason || '').slice(0, 500), status: 'pending_approval', createdAt: this.now().toISOString() };
    this.requests.set(request.id, request);
    return request;
  }
}

export default PosStore;
