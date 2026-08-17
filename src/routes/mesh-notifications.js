import express from 'express';
import MeshNotificationHub from '../core/mesh-notification-hub.js';

function requireIdentity(req) {
  const identity = req.firebaseUser;
  if (!identity?.uid && !identity?.userId) {
    const error = new Error('Verified identity is required');
    error.status = 401;
    error.code = 'IDENTITY_REQUIRED';
    throw error;
  }
  return identity;
}

function requireTenant(req, tenantId) {
  const identity = requireIdentity(req);
  if (identity.tenantId !== tenantId) {
    const error = new Error('Resource is not available in this scope');
    error.status = 404;
    error.code = 'TENANT_SCOPE_MISMATCH';
    throw error;
  }
  return identity;
}

function requireSiteAccess(identity, siteId, nodeId) {
  if (nodeId && !siteId) {
    const error = new Error('siteId is required when filtering by nodeId');
    error.status = 400;
    error.code = 'SITE_SCOPE_REQUIRED';
    throw error;
  }
  if (!siteId) return;
  const role = identity.role || identity.claims?.role;
  const tenantWide = ['owner', 'admin', 'tenant_admin', 'network_engineer'].includes(role);
  const siteIds = identity.siteIds || identity.claims?.siteIds;
  if (!tenantWide && Array.isArray(siteIds) && !siteIds.includes(siteId)) {
    const error = new Error('Resource is not available in this scope');
    error.status = 404;
    error.code = 'SITE_SCOPE_MISMATCH';
    throw error;
  }
}

function parseTypes(value) {
  if (!value) return undefined;
  const types = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  return types.length ? types.slice(0, 20) : undefined;
}

function sendError(res, error) {
  res.status(error.status || 500).json({
    code: error.code || 'MESH_NOTIFICATION_FAILED',
    error: error.message || 'Mesh notification request failed'
  });
}

export function createMeshNotificationRouter({ hub = new MeshNotificationHub(), heartbeatMs = 25000 } = {}) {
  const router = express.Router();

  router.get('/tenants/:tenantId/events', (req, res) => {
    let identity;
    try {
      identity = requireTenant(req, req.params.tenantId);
      const siteId = req.query.siteId ? String(req.query.siteId) : undefined;
      const nodeId = req.query.nodeId ? String(req.query.nodeId) : undefined;
      const meshGroupId = req.query.meshGroupId ? String(req.query.meshGroupId) : undefined;
      requireSiteAccess(identity, siteId, nodeId);
      const types = parseTypes(req.query.types);

      res.status(200);
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders?.();
      res.write(`event: ready\ndata: ${JSON.stringify({ tenantId: req.params.tenantId, principalId: identity.uid || identity.userId })}\n\n`);

      const unsubscribe = hub.subscribe({
        tenantId: req.params.tenantId,
        meshGroupId,
        siteId,
        nodeId,
        types
      }, (event) => {
        res.write(`id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
      }, heartbeatMs);
      heartbeat.unref?.();

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.once('close', cleanup);
      res.once('close', cleanup);
    } catch (error) {
      if (!res.headersSent) sendError(res, error);
      else res.end();
    }
  });

  return router;
}

export default createMeshNotificationRouter;
