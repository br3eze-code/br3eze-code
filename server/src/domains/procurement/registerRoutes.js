import crypto from 'node:crypto';
import { SupplierProvisioningService } from '../../../../src/domains/procurement/supplier-provisioning.js';
import { createSupplierApiAdapter } from '../../../../src/domains/procurement/supplier-api-adapter.js';
import { createFirestoreSupplierStore } from './firestore-supplier-store.js';

function safeReferenceUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

function errorResponse(res, error) {
  const code = error?.code || 'SUPPLIER_PROVISIONING_FAILED';
  const status = error?.status || ({
    SUPPLIER_APPROVAL_REQUIRED: 403,
    SUPPLIER_APPROVAL_SCOPE_MISMATCH: 403,
    SUPPLIER_NOT_ACTIVE: 409,
    SUPPLIER_API_NOT_CONFIGURED: 503,
    SUPPLIER_ORDER_CONFLICT: 409,
    SUPPLIER_SUBMISSION_UNKNOWN: 202,
  }[code] || (/required|must be|invalid|not found|outside the authorized|scope/.test(error?.message || '') ? 400 : 500));
  return res.status(status).json({
    error: status >= 500 ? 'Supplier provisioning is unavailable' : error.message,
    code,
    ...(error?.orderId ? { orderId: error.orderId } : {}),
    ...(code === 'SUPPLIER_SUBMISSION_UNKNOWN' ? { recoveryRequired: true } : {}),
  });
}

async function authenticatedScope(req, db) {
  const userId = req.user?.id;
  if (!userId) throw Object.assign(new Error('Authenticated user identity is missing'), { status: 401 });
  const profileSnap = await db.collection('users').doc(String(userId)).get();
  if (!profileSnap.exists) throw Object.assign(new Error('User profile not found'), { status: 403 });
  const profile = profileSnap.data();
  const tenantId = profile.tenantId || profile.organizationId;
  const projectId = profile.projectId || profile.defaultProjectId;
  if (!tenantId || !projectId) {
    throw Object.assign(new Error('User profile must define tenantId and projectId before supplier provisioning'), { status: 403 });
  }
  return { tenantId: String(tenantId), projectId: String(projectId), userId: String(userId), profile };
}

function requireProcurementRead(req) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  if (!roles.includes('ADMIN') && !permissions.includes('procurement:read') && !permissions.includes('procurement:write')) {
    throw Object.assign(new Error('Procurement read permission is required'), { status: 403, code: 'PROCUREMENT_PERMISSION_REQUIRED' });
  }
}

function requireProcurementWrite(req) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
  if (!roles.includes('ADMIN') && !permissions.includes('procurement:write')) {
    throw Object.assign(new Error('Procurement write permission is required'), { status: 403, code: 'PROCUREMENT_PERMISSION_REQUIRED' });
  }
}

async function loadApproval(db, approvalId, scope, action = 'purchase.order', proposalId = null) {
  if (!approvalId) return null;
  const snap = await db.collection('supplierApprovals').doc(String(approvalId)).get();
  if (!snap.exists) throw Object.assign(new Error('Supplier approval not found'), { code: 'SUPPLIER_APPROVAL_REQUIRED' });
  const record = snap.data();
  if (record.status !== 'APPROVED' || record.tenantId !== scope.tenantId || record.projectId !== scope.projectId || record.action !== action || (proposalId && record.proposalId !== proposalId)) {
    throw Object.assign(new Error('Approval is not approved for this tenant, project, and action'), { code: 'SUPPLIER_APPROVAL_SCOPE_MISMATCH' });
  }
  return { ...record, approvalId: snap.id };
}

export function registerSupplierProvisioningRoutes({ app, authMiddleware, db, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') throw new TypeError('Express app is required');
  if (typeof authMiddleware !== 'function') throw new TypeError('authMiddleware is required');
  if (!db || typeof db.collection !== 'function') throw new TypeError('Firestore database is required');

  const makeService = () => new SupplierProvisioningService({
    store: createFirestoreSupplierStore(db),
    supplierAdapter: createSupplierApiAdapter({ env, fetchImpl }),
  });

  // Supplier URLs are product reference links for humans/agents. They are
  // never fetched as API endpoints, avoiding arbitrary-URL server-side calls.
  app.get('/api/v1/shop/products/:productId/supplier-reference', authMiddleware, async (req, res) => {
    try {
      const scope = await authenticatedScope(req, db);
      const snap = await db.collection('products').doc(String(req.params.productId)).get();
      if (!snap.exists || snap.data().tenantId !== scope.tenantId) return res.status(404).json({ error: 'Product not found in tenant scope' });
      const product = snap.data();
      const referenceUrl = safeReferenceUrl(product.supplierReferenceUrl || product.supplierUrl);
      if (!product.supplierId || !referenceUrl) return res.status(404).json({ error: 'Product has no valid supplier reference configured' });
      const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
      const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
      const canReadCost = roles.includes('ADMIN') || permissions.includes('procurement:read') || permissions.includes('procurement:write');
      return res.json({
        productId: snap.id,
        supplierId: product.supplierId,
        supplierSku: product.supplierSku || null,
        supplierReferenceUrl: referenceUrl,
        ...(canReadCost ? {
          supplierUnitCost: Number.isFinite(Number(product.supplierUnitCost ?? product.supplierCost)) ? Number(product.supplierUnitCost ?? product.supplierCost) : null,
          supplierCurrency: String(product.supplierCurrency || product.currency || 'USD').toUpperCase(),
        } : {}),
        salePrice: Number.isFinite(Number(product.price)) ? Number(product.price) : null,
        stock: Number(product.stock || 0),
        fulfillmentMode: product.supplierFulfillmentMode || 'restock',
      });
    } catch (error) { return errorResponse(res, error); }
  });

  // Without a persisted approval, this endpoint returns a proposal and does
  // not call the external supplier. Approval IDs supplied by clients are only
  // accepted after server-side lookup and tenant/project/action validation.
  app.post('/api/v1/shop/supplier-orders', authMiddleware, async (req, res) => {
    try {
      requireProcurementRead(req);
      const scope = await authenticatedScope(req, db);
      const { productId, quantity, approvalId, proposalId } = req.body || {};
      const qty = Number(quantity);
      if (typeof productId !== 'string' || !productId.trim() || !Number.isSafeInteger(qty) || qty <= 0 || qty > 100000) {
        return res.status(400).json({ error: 'productId and quantity (1..100000) are required' });
      }
      const productSnap = await db.collection('products').doc(productId).get();
      if (!productSnap.exists || productSnap.data().tenantId !== scope.tenantId) return res.status(404).json({ error: 'Product not found in tenant scope' });
      const product = productSnap.data();
      const supplierReferenceUrl = safeReferenceUrl(product.supplierReferenceUrl || product.supplierUrl);
      const supplierId = typeof product.supplierId === 'string' ? product.supplierId.trim() : '';
      const unitPrice = Number(product.supplierUnitCost ?? product.supplierCost);
      const currency = String(product.supplierCurrency || product.currency || 'USD').toUpperCase();
      if (!supplierId || !supplierReferenceUrl || !Number.isFinite(unitPrice) || unitPrice < 0) {
        return res.status(409).json({ error: 'Product requires supplierId, HTTPS supplierReferenceUrl, and supplierUnitCost before provisioning' });
      }
      const request = {
        orderId: `po-${crypto.randomUUID()}`,
        supplierId,
        lines: [{
          productId,
          quantity: qty,
          unitPrice,
          currency,
          supplierSku: product.supplierSku || null,
          supplierReferenceUrl,
        }],
        requiredAcceptanceEvidence: ['receipt_inspection', 'customer_acceptance'],
      };
      const idempotencyKey = String(req.get('idempotency-key') || req.body?.idempotencyKey || '').trim();
      if (!idempotencyKey || idempotencyKey.length > 200) return res.status(400).json({ error: 'An idempotency-key header or idempotencyKey is required (max 200 characters)' });
      if (!approvalId) {
        requireProcurementWrite(req);
        const proposal = {
          ...request,
          proposalId: request.orderId,
          status: 'PENDING_APPROVAL',
          action: 'purchase.order',
          tenantId: scope.tenantId,
          projectId: scope.projectId,
          requestedBy: scope.userId,
          idempotencyKey,
          estimatedTotal: Number((qty * unitPrice).toFixed(2)),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        // Persist the exact server-calculated proposal before returning it.
        // A client-supplied approval ID alone must never authorize execution.
        await db.collection('supplierOrderProposals').doc(proposal.proposalId).create(proposal);
        return res.status(202).json({
          status: 'approval_required',
          action: 'purchase.order',
          proposal,
          externalSupplierCalled: false,
        });
      }
      requireProcurementWrite(req);
      if (typeof proposalId !== 'string' || !proposalId.trim()) {
        return res.status(400).json({ error: 'proposalId from the persisted proposal is required for approved submission' });
      }
      const proposalSnap = await db.collection('supplierOrderProposals').doc(proposalId).get();
      if (!proposalSnap.exists) return res.status(404).json({ error: 'Persisted purchase proposal not found' });
      const proposal = proposalSnap.data();
      if (proposal.status !== 'APPROVED' || proposal.tenantId !== scope.tenantId || proposal.projectId !== scope.projectId ||
          proposal.lines?.[0]?.productId !== productId || proposal.lines?.[0]?.quantity !== qty ||
          proposal.lines?.[0]?.unitPrice !== unitPrice || proposal.supplierId !== supplierId ||
          proposal.idempotencyKey !== idempotencyKey) {
        return res.status(409).json({ error: 'Submission does not match the approved persisted proposal' });
      }
      const approval = await loadApproval(db, approvalId, scope, 'purchase.order', proposalId);
      if (proposal.approvalId !== approvalId) return res.status(403).json({ error: 'Approval does not match the proposal' });
      const result = await makeService().createPurchaseOrder({ request: { ...request, orderId: proposal.orderId }, scope, approval, idempotencyKey });
      return res.status(result.replay ? 200 : 201).json({ ...result, supplierReferenceUrl });
    } catch (error) { return errorResponse(res, error); }
  });

  // Approval is a separate, explicit human action against a persisted proposal.
  // Only ADMIN may approve; approval is scoped to the same tenant/project and proposal.
  app.post('/api/v1/shop/supplier-orders/:orderId/approval', authMiddleware, async (req, res) => {
    try {
      const scope = await authenticatedScope(req, db);
      const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
      if (!roles.includes('ADMIN')) return res.status(403).json({ error: 'ADMIN approval is required' });
      const proposalRef = db.collection('supplierOrderProposals').doc(String(req.params.orderId));
      const proposalSnap = await proposalRef.get();
      if (!proposalSnap.exists) return res.status(404).json({ error: 'Purchase proposal not found' });
      const proposal = proposalSnap.data();
      if (proposal.tenantId !== scope.tenantId || proposal.projectId !== scope.projectId ||
          proposal.action !== 'purchase.order' || proposal.status !== 'PENDING_APPROVAL') {
        return res.status(409).json({ error: 'Proposal is not pending approval in this tenant/project scope' });
      }
      if (proposal.requestedBy === scope.userId) {
        return res.status(403).json({ error: 'Requester cannot approve their own purchase proposal' });
      }
      const approvalRef = db.collection('supplierApprovals').doc();
      const now = new Date().toISOString();
      const approval = {
        status: 'APPROVED',
        action: 'purchase.order',
        approvalId: approvalRef.id,
        proposalId: proposalRef.id,
        tenantId: scope.tenantId,
        projectId: scope.projectId,
        approvedBy: scope.userId,
        createdAt: now,
      };
      await db.runTransaction(async (tx) => {
        const current = await tx.get(proposalRef);
        const currentProposal = current.exists ? current.data() : null;
        if (!currentProposal || currentProposal.status !== 'PENDING_APPROVAL' ||
            currentProposal.tenantId !== scope.tenantId ||
            currentProposal.projectId !== scope.projectId ||
            currentProposal.action !== 'purchase.order' ||
            currentProposal.requestedBy === scope.userId) {
          throw Object.assign(new Error('Proposal is no longer eligible for approval in this scope'), { status: 409 });
        }
        tx.create(approvalRef, approval);
        tx.update(proposalRef, { status: 'APPROVED', approvalId: approvalRef.id, approvedBy: scope.userId, approvedAt: now, updatedAt: now });
      });
      return res.status(201).json({ status: 'APPROVED', proposalId: proposalRef.id, approvalId: approvalRef.id });
    } catch (error) { return errorResponse(res, error); }
  });

  app.get('/api/v1/shop/supplier-orders/:orderId', authMiddleware, async (req, res) => {
    try {
      requireProcurementRead(req);
      const scope = await authenticatedScope(req, db);
      const result = await makeService().recover({ orderId: String(req.params.orderId), scope });
      return res.json(result);
    } catch (error) { return errorResponse(res, error); }
  });

  app.post('/api/v1/shop/supplier-orders/:orderId/receipts', authMiddleware, async (req, res) => {
    try {
      requireProcurementWrite(req);
      const scope = await authenticatedScope(req, db);
      const { receiptId, lines, evidence } = req.body || {};
      if (typeof receiptId !== 'string' || !receiptId.trim()) return res.status(400).json({ error: 'receiptId is required' });
      const result = await makeService().receivePartial({ orderId: String(req.params.orderId), scope, receiptId, lines, evidence });
      return res.json(result);
    } catch (error) { return errorResponse(res, error); }
  });

  app.post('/api/v1/shop/supplier-orders/:orderId/invoice-match', authMiddleware, async (req, res) => {
    try {
      requireProcurementWrite(req);
      const scope = await authenticatedScope(req, db);
      const { invoice, approvalId } = req.body || {};
      const approval = await loadApproval(db, approvalId, scope, 'settlement.release');
      const result = await makeService().matchInvoice({ orderId: String(req.params.orderId), scope, invoice, approval });
      return res.status(result.matched ? 200 : 409).json(result);
    } catch (error) { return errorResponse(res, error); }
  });

  app.post('/api/v1/shop/supplier-orders/:orderId/close', authMiddleware, async (req, res) => {
    try {
      requireProcurementWrite(req);
      const scope = await authenticatedScope(req, db);
      const { acceptanceEvidence = [] } = req.body || {};
      const result = await makeService().closeOrder({ orderId: String(req.params.orderId), scope, acceptanceEvidence });
      return res.status(result.closed ? 200 : 409).json(result);
    } catch (error) { return errorResponse(res, error); }
  });

  return { makeService };
}

export { safeReferenceUrl };
