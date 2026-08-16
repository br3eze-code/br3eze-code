import express from 'express';
import * as shop from '../../core/shop.js';
import { PosStore } from '../../core/pos-store.js';

const router = express.Router();
const store = new PosStore();
const CASHIER_ROLES = new Set(['cashier', 'reseller', 'partner', 'admin', 'owner']);

const fail = (res, error) => res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || 'POS_ERROR' });
const ok = (res, data) => res.json({ ok: true, data });

function contextFromRequest(req) {
  const identity = req.firebaseUser || {};
  const header = (name) => req.headers[`x-agentos-${name}`] || null;
  const role = String(identity.role || header('role') || 'user').toLowerCase();
  const context = {
    userId: identity.uid || header('user-id'),
    tenantId: identity.tenantId || identity.tenant || header('tenant-id'),
    siteId: identity.siteId || header('site-id'),
    terminalId: identity.terminalId || header('terminal-id'),
    shiftId: identity.shiftId || header('shift-id'),
    role,
    channel: header('channel') || 'pos',
    domain: header('domain') || 'commerce',
  };
  if (!context.userId || !context.tenantId || !context.siteId || !context.terminalId) {
    throw Object.assign(new Error('Authenticated POS context requires user, tenant, site, and terminal'), { status: 401, code: 'POS_CONTEXT_REQUIRED' });
  }
  if (!CASHIER_ROLES.has(role)) throw Object.assign(new Error('Cashier role required'), { status: 403, code: 'POS_ROLE_REQUIRED' });
  return context;
}

function requireApproval(req) {
  const approval = String(req.headers['x-agentos-mutation-approval'] || '').toLowerCase();
  if (!['approved', 'explicit'].includes(approval)) throw Object.assign(new Error('Explicit approval is required for this POS mutation'), { status: 428, code: 'APPROVAL_REQUIRED' });
}

router.get('/context', (req, res) => {
  try {
    const context = contextFromRequest(req);
    let shift = null;
    try { shift = store.getShift(context); } catch (_error) { shift = null; }
    ok(res, { context: { userId: context.userId, tenantId: context.tenantId, siteId: context.siteId, terminalId: context.terminalId, role: context.role, channel: context.channel, domain: context.domain }, shift, actions: ['sale.create', 'sale.hold', 'sale.recall', 'payment.start', 'receipt.issue', 'refund.request', 'void.request', 'shift.open', 'shift.close'] });
  } catch (error) { fail(res, error); }
});

router.get('/catalog', async (req, res) => {
  try {
    contextFromRequest(req);
    ok(res, await shop.listProducts({ category: req.query.category, search: req.query.search }));
  } catch (error) { fail(res, error); }
});

router.post('/shifts/open', (req, res) => {
  try {
    const context = contextFromRequest(req);
    ok(res, store.openShift(context, req.body?.openingFloat));
  } catch (error) { fail(res, error); }
});

router.get('/shifts/current', (req, res) => {
  try { ok(res, store.getShift(contextFromRequest(req))); } catch (error) { fail(res, error); }
});

router.post('/sales', (req, res) => {
  try {
    const context = contextFromRequest(req);
    ok(res, store.createSale(context, req.body?.items, req.body?.customer));
  } catch (error) { fail(res, error); }
});

router.get('/sales/:id', (req, res) => {
  try { ok(res, store.getSale(req.params.id, contextFromRequest(req))); } catch (error) { fail(res, error); }
});

router.post('/sales/:id/hold', (req, res) => {
  try { ok(res, store.holdSale(req.params.id, contextFromRequest(req))); } catch (error) { fail(res, error); }
});

router.post('/sales/:id/recall', (req, res) => {
  try { ok(res, store.recallSale(req.params.id, contextFromRequest(req))); } catch (error) { fail(res, error); }
});

router.post('/sales/:id/payments', (req, res) => {
  try {
    const context = contextFromRequest(req);
    const idempotencyKey = req.headers['idempotency-key'];
    ok(res, store.startPayment(req.params.id, context, req.body?.provider, idempotencyKey));
  } catch (error) { fail(res, error); }
});

router.get('/payments/:id', (req, res) => {
  try { ok(res, store.getPayment(req.params.id, contextFromRequest(req))); } catch (error) { fail(res, error); }
});

router.post('/sales/:id/refund-request', (req, res) => {
  try {
    const context = contextFromRequest(req);
    requireApproval(req);
    ok(res, store.requestCorrection('refund', req.params.id, context, req.body?.reason));
  } catch (error) { fail(res, error); }
});

router.post('/sales/:id/void-request', (req, res) => {
  try {
    const context = contextFromRequest(req);
    requireApproval(req);
    ok(res, store.requestCorrection('void', req.params.id, context, req.body?.reason));
  } catch (error) { fail(res, error); }
});

export { contextFromRequest, requireApproval };
export default router;
