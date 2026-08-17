import express from 'express';
import MeshManagementStore from '../core/mesh-management-store.js';
import MeshNotificationHub from '../core/mesh-notification-hub.js';

const MANAGEMENT_ROLES = new Set(['owner', 'admin', 'network_engineer', 'operator', 'project_manager']);

function identityRequired(req) {
  const identity = req.firebaseUser;
  if (!identity?.uid && !identity?.userId) {
    const error = new Error('Verified identity is required');
    error.code = 'IDENTITY_REQUIRED';
    error.status = 401;
    throw error;
  }
  return identity;
}

function scope(req, tenantId) {
  const identity = identityRequired(req);
  const principalId = identity.uid || identity.userId;
  if (identity.tenantId !== tenantId) {
    const error = new Error('Resource is not available in this scope');
    error.code = 'TENANT_SCOPE_MISMATCH';
    error.status = 404;
    throw error;
  }
  return { principalId, tenantId, role: identity.role || 'viewer' };
}

function requireRole(req, tenantId) {
  const context = scope(req, tenantId);
  if (!MANAGEMENT_ROLES.has(context.role)) {
    const error = new Error('Mesh management role is required');
    error.code = 'MESH_MANAGEMENT_ROLE_REQUIRED';
    error.status = 403;
    throw error;
  }
  return context;
}

function idempotencyKey(req) {
  const key = req.get('Idempotency-Key');
  return key && key.length <= 200 ? key : undefined;
}

function sendError(res, error) {
  res.status(error.status || 500).json({
    code: error.code || 'MESH_MANAGEMENT_FAILED',
    error: error.message || 'Mesh management request failed'
  });
}

export function createMeshManagementRouter({ store = new MeshManagementStore(), notifications = new MeshNotificationHub() } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '20kb' }));

  router.post('/tenants/:tenantId/mesh-groups', (req, res) => {
    try {
      const context = requireRole(req, req.params.tenantId);
      const group = store.createMeshGroup({
        ...context,
        projectId: req.body?.projectId || null,
        displayName: req.body?.displayName,
        meshKey: req.body?.meshKey,
        idempotencyKey: idempotencyKey(req)
      });
      notifications.publish({ type: 'mesh_group.created', tenantId: group.tenantId, meshGroupId: group.meshGroupId, resource: group });
      res.status(201).json({ ok: true, data: group });
    } catch (error) { sendError(res, error); }
  });

  router.get('/tenants/:tenantId/mesh-groups', (req, res) => {
    try {
      const context = scope(req, req.params.tenantId);
      res.json({ ok: true, data: store.listMeshGroups(context.tenantId) });
    } catch (error) { sendError(res, error); }
  });

  router.get('/tenants/:tenantId/mesh-groups/:meshGroupId', (req, res) => {
    try {
      const context = scope(req, req.params.tenantId);
      res.json({ ok: true, data: store.getMeshGroup(context.tenantId, req.params.meshGroupId) });
    } catch (error) { sendError(res, error); }
  });

  router.post('/tenants/:tenantId/mesh-groups/:meshGroupId/sites', (req, res) => {
    try {
      const context = requireRole(req, req.params.tenantId);
      const site = store.createSite({
        ...context,
        meshGroupId: req.params.meshGroupId,
        siteKey: req.body?.siteKey,
        displayName: req.body?.displayName,
        timezone: req.body?.timezone || 'UTC',
        idempotencyKey: idempotencyKey(req)
      });
      notifications.publish({ type: 'site.created', tenantId: site.tenantId, meshGroupId: site.meshGroupId, siteId: site.siteId, resource: site });
      res.status(201).json({ ok: true, data: site });
    } catch (error) { sendError(res, error); }
  });

  router.get('/tenants/:tenantId/mesh-groups/:meshGroupId/sites', (req, res) => {
    try {
      const context = scope(req, req.params.tenantId);
      res.json({ ok: true, data: store.listSites(context.tenantId, req.params.meshGroupId) });
    } catch (error) { sendError(res, error); }
  });

  router.get('/tenants/:tenantId/mesh-groups/:meshGroupId/sites/:siteId', (req, res) => {
    try {
      const context = scope(req, req.params.tenantId);
      res.json({ ok: true, data: store.getSite(context.tenantId, req.params.meshGroupId, req.params.siteId) });
    } catch (error) { sendError(res, error); }
  });

  router.post('/tenants/:tenantId/mesh-groups/:meshGroupId/sites/:siteId/nodes', (req, res) => {
    try {
      const context = requireRole(req, req.params.tenantId);
      const node = store.createNode({
        ...context,
        meshGroupId: req.params.meshGroupId,
        siteId: req.params.siteId,
        nodeKey: req.body?.nodeKey,
        nodeType: req.body?.nodeType,
        displayName: req.body?.displayName,
        transport: req.body?.transport || 'outbound_agent',
        idempotencyKey: idempotencyKey(req)
      });
      notifications.publish({ type: 'node.created', tenantId: node.tenantId, meshGroupId: node.meshGroupId, siteId: node.siteId, nodeId: node.nodeId, resource: node });
      res.status(201).json({ ok: true, data: node });
    } catch (error) { sendError(res, error); }
  });

  router.get('/tenants/:tenantId/mesh-groups/:meshGroupId/sites/:siteId/nodes', (req, res) => {
    try {
      const context = scope(req, req.params.tenantId);
      res.json({ ok: true, data: store.listNodes(context.tenantId, req.params.meshGroupId, req.params.siteId) });
    } catch (error) { sendError(res, error); }
  });

  router.get('/tenants/:tenantId/mesh-groups/:meshGroupId/sites/:siteId/nodes/:nodeId', (req, res) => {
    try {
      const context = scope(req, req.params.tenantId);
      res.json({ ok: true, data: store.getNode(context.tenantId, req.params.meshGroupId, req.params.siteId, req.params.nodeId) });
    } catch (error) { sendError(res, error); }
  });

  router.patch('/tenants/:tenantId/mesh-groups/:meshGroupId/sites/:siteId/nodes/:nodeId/status', (req, res) => {
    try {
      const context = requireRole(req, req.params.tenantId);
      const node = store.updateNodeStatus({
        ...context,
        meshGroupId: req.params.meshGroupId,
        siteId: req.params.siteId,
        nodeId: req.params.nodeId,
        status: req.body?.status,
        idempotencyKey: idempotencyKey(req)
      });
      notifications.publish({ type: 'node.status_changed', tenantId: node.tenantId, meshGroupId: node.meshGroupId, siteId: node.siteId, nodeId: node.nodeId, resource: node });
      res.json({ ok: true, data: node });
    } catch (error) { sendError(res, error); }
  });

  return router;
}

export default createMeshManagementRouter;
