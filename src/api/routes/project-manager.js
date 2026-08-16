import express from 'express';
import { WbsService } from '../../core/wbs-service.js';
import { ProjectManagerCoordinator } from '../../core/project-manager-coordinator.js';

const defaultWbsService = new WbsService();
const defaultCoordinator = new ProjectManagerCoordinator({ wbsService: defaultWbsService });
const MANAGER_ROLES = new Set(['project_manager', 'manager', 'planner', 'admin', 'owner']);

function fail(res, error) {
  return res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || 'PROJECT_MANAGER_ERROR' });
}

function contextFromRequest(req) {
  const identity = req.firebaseUser || {};
  const claims = identity.customClaims || {};
  const header = (name) => req.headers[`x-agentos-${name}`] || null;
  const role = String(identity.role || claims.role || header('role') || 'user').toLowerCase();
  if (!identity.uid) throw Object.assign(new Error('Verified identity is required'), { status: 401, code: 'IDENTITY_REQUIRED' });
  if (!MANAGER_ROLES.has(role)) throw Object.assign(new Error('Project Manager or authorized manager role required'), { status: 403, code: 'PROJECT_MANAGER_ROLE_REQUIRED' });
  const context = {
    userId: identity.uid,
    tenantId: identity.tenantId || claims.tenantId || header('tenant-id'),
    siteId: identity.siteId || claims.siteId || header('site-id'),
    domain: identity.domainId || claims.domainId || header('domain') || 'general',
    channel: header('channel') || 'rest',
    role
  };
  if (!context.tenantId) throw Object.assign(new Error('Tenant identity is required'), { status: 401, code: 'TENANT_REQUIRED' });
  return context;
}

function approvalContext(req, context) {
  return { ...context, approvalGranted: ['approved', 'explicit'].includes(String(req.headers['x-agentos-mutation-approval'] || '').toLowerCase()) };
}

function createProjectManagerRouter({ coordinator = defaultCoordinator } = {}) {
  const router = express.Router();

  router.post('/projects', async (req, res) => {
  try {
    const context = contextFromRequest(req);
    const result = await coordinator.createProject({ context, name: req.body?.name, projectId: req.body?.projectId, domain: req.body?.domain || context.domain, roles: req.body?.roles, metadata: req.body?.metadata });
    return res.status(201).json({ ok: true, data: result });
    } catch (error) { return fail(res, error); }
  });

  router.get('/projects', async (req, res) => {
  try { return res.json({ ok: true, data: await coordinator.getProjectPlan({ ...contextFromRequest(req), projectId: req.query.projectId || null, domain: req.query.domain || undefined }) });     } catch (error) { return fail(res, error); }
  });

  router.post('/packages/:wbsId/transition', async (req, res) => {
  try {
    const context = approvalContext(req, { ...contextFromRequest(req), projectId: req.body?.projectId || null });
    const result = await coordinator.transitionPackage({ wbsId: req.params.wbsId, status: req.body?.status, evidenceRefs: req.body?.evidenceRefs, reason: req.body?.reason, context });
    return res.json({ ok: true, data: result });
    } catch (error) { return fail(res, error); }
  });

  router.post('/handoffs', async (req, res) => {
  try {
    const context = { ...contextFromRequest(req), projectId: req.body?.projectId || null };
    const result = await coordinator.proposeHandoff({ wbsId: req.body?.wbsId, fromRole: req.body?.fromRole || context.role, toRole: req.body?.toRole, toUserId: req.body?.toUserId, payload: req.body?.payload, context });
    return res.status(201).json({ ok: true, data: result });
    } catch (error) { return fail(res, error); }
  });

  return router;
}

export { contextFromRequest, createProjectManagerRouter };
export { defaultCoordinator as projectManagerCoordinator };
export default createProjectManagerRouter();
