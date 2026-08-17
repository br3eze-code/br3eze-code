import express from 'express';
import { createProjectManagerContext, assertProjectScope, requirePermission } from '../core/project-manager-context.js';
import { ProjectManagerStateStore } from '../core/project-manager-state-store.js';
import { createRoleBoundHandoff, createApproval, confirmApproval } from '../core/wbs-handoff-schema.js';

function sendError(res, error) {
  const status = error.statusCode || 500;
  res.status(status).json({ ok: false, error: error.message, code: error.code || 'PROJECT_MANAGER_ERROR' });
}

export function projectManagerContextMiddleware(req, res, next) {
  try {
    req.projectManagerContext = createProjectManagerContext(req, {
      projectId: req.params.projectId || req.body?.projectId,
      wbsPackageId: req.body?.wbsPackageId,
      conversationId: req.body?.conversationId || req.query?.conversationId,
      channel: req.body?.channel || req.headers['x-channel'] || 'pwa',
    });
    next();
  } catch (error) { sendError(res, error); }
}

export function createProjectManagerRouter({ store = new ProjectManagerStateStore(), coordinator = null, now = () => Date.now() } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '20kb' }));
  router.use(projectManagerContextMiddleware);

  router.get('/state', (req, res) => {
    const context = req.projectManagerContext;
    const session = store.getSession(context.sessionId);
    res.json({ ok: true, context: { ...context, permissions: undefined }, session });
  });

  router.get('/projects/:projectId/wbs', (req, res) => {
    try {
      const context = req.projectManagerContext;
      requirePermission(context, 'wbs.read');
      assertProjectScope(context, req.params.projectId);
      res.json({ ok: true, project: store.getProject(req.params.projectId, context.tenantId), packages: store.listPackages(req.params.projectId, context.tenantId) });
    } catch (error) { sendError(res, error); }
  });

  router.post('/message', async (req, res) => {
    try {
      const context = req.projectManagerContext;
      requirePermission(context, 'project.message');
      const previous = store.getSession(context.sessionId) || { sessionId: context.sessionId, tenantId: context.tenantId, userId: context.userId, channelHistory: [] };
      const event = { role: 'user', content: String(req.body.message || ''), channel: context.channel, projectId: context.projectId, createdAt: new Date().toISOString() };
      if (!event.content.trim()) return res.status(400).json({ ok: false, error: 'message is required', code: 'MESSAGE_REQUIRED' });
      const session = store.saveSession({ ...previous, tenantId: context.tenantId, userId: context.userId, projectId: context.projectId, channelHistory: [...(previous.channelHistory || []), event] });
      const result = coordinator?.handleMessage ? await coordinator.handleMessage(event.content, context, session) : { status: 'received', nextAction: 'review_wbs' };
      res.json({ ok: true, context: { requestId: context.requestId, sessionId: context.sessionId, channel: context.channel, projectId: context.projectId }, session, result });
    } catch (error) { sendError(res, error); }
  });

  router.post('/handoffs', (req, res) => {
    try {
      const context = req.projectManagerContext;
      const handoff = createRoleBoundHandoff({ context, projectId: req.body.projectId, packageId: req.body.packageId, specialist: req.body.specialist, action: req.body.action, inputScope: req.body.inputScope, summary: req.body.summary });
      store.saveHandoff(handoff);
      const approval = handoff.approvalRequired ? store.saveApproval(createApproval({ context: { ...context, projectId: handoff.projectId }, handoffId: handoff.handoffId, action: handoff.action, argumentsValue: req.body })) : null;
      res.status(201).json({ ok: true, handoff, approval });
    } catch (error) { sendError(res, error); }
  });

  router.post('/approvals/:approvalId/confirm', (req, res) => {
    try {
      const context = req.projectManagerContext;
      const approval = store.getApproval(req.params.approvalId, context.tenantId);
      const confirmed = confirmApproval(approval, context, now());
      store.saveApproval(confirmed);
      res.json({ ok: true, approval: confirmed });
    } catch (error) { sendError(res, error); }
  });

  return router;
}

export default createProjectManagerRouter;
