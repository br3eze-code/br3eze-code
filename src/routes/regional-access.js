import express from 'express';
import { RegionalAccessError, RegionalScopeError } from '../core/regional-access-adapter.js';

const MANAGEMENT_ROLES = new Set(['owner', 'admin', 'network_engineer', 'operator', 'project_manager']);
const READ_ROLES = new Set([...MANAGEMENT_ROLES, 'auditor', 'viewer']);

function identity(req) {
  const user = req.firebaseUser || req.user;
  const claims = user?.customClaims || {};
  if (!user?.uid) return null;
  return {
    principalId: user.uid,
    tenantId: user.tenantId || claims.tenantId || null,
    regionId: user.regionId || claims.regionId || null,
    siteId: user.siteId || claims.siteId || null,
    role: user.role || claims.role || null,
    channel: req.headers['x-channel'] || 'http',
  };
}

function authorize(req, tenantId, regionId, siteId, roles = READ_ROLES) {
  const user = identity(req);
  if (!user) return { ok: false, status: 401, error: 'Authenticated identity required' };
  if (user.tenantId !== tenantId) return { ok: false, status: 404, error: 'Resource not available in this scope' };
  if (user.regionId && user.regionId !== regionId) return { ok: false, status: 404, error: 'Resource not available in this scope' };
  if (user.siteId && user.siteId !== siteId) return { ok: false, status: 404, error: 'Resource not available in this scope' };
  if (!roles.has(user.role)) return { ok: false, status: 403, error: 'Insufficient regional access permission' };
  return { ok: true, user };
}

function context(req, params, user) {
  return {
    principalId: user.principalId,
    tenantId: params.tenantId,
    regionId: params.regionId,
    siteId: params.siteId,
    channel: user.channel,
    correlationId: req.headers['x-correlation-id'] || undefined,
  };
}

function sendError(res, error) {
  if (error instanceof RegionalScopeError) return res.status(error.status).json({ error: error.code, message: error.message });
  if (error instanceof RegionalAccessError) return res.status(error.status).json({ error: error.code, message: error.message, retryable: error.retryable });
  return res.status(502).json({ error: 'REGIONAL_PROVIDER_ERROR', message: 'Regional provider unavailable' });
}

export function createRegionalAccessRouter({ adapter, logger = console } = {}) {
  if (!adapter) throw new TypeError('regional access adapter is required');
  const router = express.Router();

  router.post('/tenants/:tenantId/regions/:regionId/sites/:siteId/users/provision', async (req, res) => {
    const auth = authorize(req, req.params.tenantId, req.params.regionId, req.params.siteId, MANAGEMENT_ROLES);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    try {
      return res.status(201).json(await adapter.provisionUser(context(req, req.params, auth.user), req.body.user, req.body.policy));
    } catch (error) { logger.error?.(error); return sendError(res, error); }
  });

  router.post('/tenants/:tenantId/regions/:regionId/sites/:siteId/users/:userId/suspend', async (req, res) => {
    const auth = authorize(req, req.params.tenantId, req.params.regionId, req.params.siteId, MANAGEMENT_ROLES);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    try {
      return res.json(await adapter.suspendUser(context(req, req.params, auth.user), req.params.userId, req.body.reason));
    } catch (error) { logger.error?.(error); return sendError(res, error); }
  });

  router.post('/tenants/:tenantId/regions/:regionId/sites/:siteId/users/authenticate', async (req, res) => {
    const auth = authorize(req, req.params.tenantId, req.params.regionId, req.params.siteId, READ_ROLES);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    try {
      return res.json(await adapter.authenticateUser(context(req, req.params, auth.user), req.body));
    } catch (error) { logger.error?.(error); return sendError(res, error); }
  });

  router.get('/tenants/:tenantId/regions/:regionId/sites/:siteId/users/:userId/usage', async (req, res) => {
    const auth = authorize(req, req.params.tenantId, req.params.regionId, req.params.siteId, READ_ROLES);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    try {
      return res.json(await adapter.getUsage(context(req, req.params, auth.user), req.params.userId, req.query));
    } catch (error) { logger.error?.(error); return sendError(res, error); }
  });

  router.get('/tenants/:tenantId/regions/:regionId/sites/:siteId/health', async (req, res) => {
    const auth = authorize(req, req.params.tenantId, req.params.regionId, req.params.siteId, READ_ROLES);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    try {
      return res.json(await adapter.health(context(req, req.params, auth.user)));
    } catch (error) { logger.error?.(error); return sendError(res, error); }
  });

  return router;
}

export default createRegionalAccessRouter;
